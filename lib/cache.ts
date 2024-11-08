import { FileCache } from "./file-cache";
import { RedisCache } from "./redis-cache";

export interface Cache {
  get(key: string, initial?: any): Promise<any>;
  set(key: string, value: any): Promise<void>;
  mset(values: { [key: string]: any }): Promise<void>;
  destroy(): void;
}

export { FileCache, RedisCache };
