import type { DeliveryLog } from "./types.js";

export function printLog(event: DeliveryLog): void {
  console.log(JSON.stringify(event));
}
