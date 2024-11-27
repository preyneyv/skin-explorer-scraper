import pLimit from "p-limit";
import Fuse from "fuse.js";
import cheerio from "cheerio";
import axios from "axios";
import { splitId, parsePatch, comparePatches } from "./helpers.mjs";
import {
  CDRAGON,
  ALIASES,
  IGNORED_WARNINGS,
  MIN_SUPPORTED_VERSION,
} from "../constants.mjs";

const limit = pLimit(10);
const PATCH_REGEX = /^\d+\.\d+$/;

export async function fetchSkinChanges(champions, skins) {
  console.log(`[Skin Changes] Retrieving patch list...`);
  const patches = (await axios.get(`${CDRAGON}/json`)).data
    .filter(
      (entry) => entry.type === "directory" && entry.name.match(PATCH_REGEX)
    )
    .map((e) => parsePatch(e.name))
    .sort((a, b) => -comparePatches(a, b));
  console.log(`[Skin Changes] Updating... (${champions.length} champions)`);
  const changes = {};
  let i = 0;
  await Promise.all(
    champions.map((c) =>
      limit(async () => {
        Object.assign(changes, await getSkinArtChanges(c, skins, patches));
        console.log(
          `[Skin Changes] Completed ${c.name}. (${++i}/${champions.length})`
        );
      })
    )
  );
  console.log("[Skin Changes] Update complete.");
  return changes;
}

/**
 * Parse a champion's Patch History page from Fandom to find which patches had
 * changed skins.
 *
 * https://leagueoflegends.fandom.com/wiki/Aatrox/LoL/Patch_history
 */
async function getSkinArtChanges(champion, skins, patches) {
  const changes = {};
  const champSkins = new Fuse(
    Object.values(skins).filter((skin) => splitId(skin.id)[0] === champion.id),
    {
      keys: ["name"],
      threshold: 0.1,
    }
  );

  let responseBody;
  try {
    responseBody = (
      await axios.get(
        `https://leagueoflegends.fandom.com/wiki/${champion.name}/LoL/Patch_history?action=render`
      )
    ).data;
  } catch (e) {
    console.error(`[Skin Changes] ${champion.name}: ${e}`);
    return {};
  }
  const $ = cheerio.load(responseBody, false);

  $("dl dt a")
    .toArray()
    .filter((el) => {
      const t = $(el).attr("title");
      if (!t.startsWith("V")) return false;

      const split = t.slice(1).split(".");
      if (!split.length === 2) return false;

      const patch = split.map((e) => parseInt(e, 10));
      if (comparePatches(patch, MIN_SUPPORTED_VERSION) <= 0) return false;

      return true;
    })
    .map((x) => {
      const t = $(x).parents("dl"),
        c = t.next(),
        subset = c.find(':contains(" art")');
      if (!subset.length) return;

      const patch = parsePatch(t.find("a").attr("title").slice(1));
      const prevPatch =
        patches[
          patches.findIndex((p) => comparePatches(p, patch) === 0) + 1
        ].join(".");
      subset.each((_, el) => {
        $(el)
          .find("a[href]")
          .each((_, link) => {
            const name = $(link).text().trim();
            if (!name) return;

            let matches = champSkins.search(name, { limit: 1 });
            if (!matches.length) {
              if (name.startsWith("Original ")) {
                matches = champSkins.search(name.slice(9), { limit: 1 });
              }
              if (ALIASES[name]) {
                matches = champSkins.search(ALIASES[name], { limit: 1 });
              }

              if (!matches.length) {
                if (!IGNORED_WARNINGS.includes(name)) {
                  console.error(
                    `Couldn't find a match for ${name} (${champion.name})`
                  );
                }
                return;
              }
            }
            const skin = matches[0].item;
            changes[skin.id] = new Set([
              ...(changes[skin.id] ?? []),
              prevPatch,
            ]);
          });
      });
    });

  return Object.keys(changes).reduce(
    (obj, key) => ({
      ...obj,
      [key]: [...changes[key]].sort(
        (a, b) => -comparePatches(parsePatch(a), parsePatch(b))
      ),
    }),
    {}
  );
}
