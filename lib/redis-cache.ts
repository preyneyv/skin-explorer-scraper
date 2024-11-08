import "dotenv/config";
import Redis from "ioredis";
import { Cache } from "./cache";

function chunkString(str: string, len: number): string[] {
  const size = Math.ceil(str.length / len);
  const r: string[] = Array(size);
  let offset = 0;

  for (let i = 0; i < size; i++) {
    r[i] = str.substr(offset, len);
    offset += len;
  }

  return r;
}

const CHUNK_SIZE = 120000;

export class RedisCache implements Cache {
  private redis: Redis.Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL);
  }

  async get(key: Redis.KeyType, initial: any | null = null): Promise<any> {
    let str = await this.redis.getrange(key, 0, CHUNK_SIZE - 1);
    if (!str) {
      return initial;
    }

    let data: any,
      i = 1;
    while (true) {
      try {
        data = JSON.parse(str);
        break;
      } catch (e) {
        if (e instanceof SyntaxError) {
          str +=
            (await this.redis.getrange(
              key,
              CHUNK_SIZE * i,
              CHUNK_SIZE * (i + 1) - 1,
            )) || "";
          i++;
        } else {
          throw e;
        }
      }
    }

    return data;
  }

  async set(key: Redis.KeyType, value: any) {
    const data = JSON.stringify(value);
    const split = chunkString(data, CHUNK_SIZE);
    await this.redis.set(key, split[0]);
    for (const chunk of split.slice(1)) {
      await this.redis.append(key, chunk);
    }
  }

  async mset(values: { [x: string]: any }) {
    await this.redis.mset(
      Object.keys(values).reduce(
        (obj, key) => ({ ...obj, [key]: JSON.stringify(values[key]) }),
        {},
      ),
    );
  }

  destroy() {
    this.redis.disconnect();
  }
}

export default RedisCache;
