// Agent 3.2 — sms body. Uses the shared copy call's single line. A link is appended
// by the delivery layer, not here.
import type { CopyBundle } from "../../../shared/types";

export function buildSms(copy: CopyBundle): string {
  return copy.smsLine.slice(0, 160);
}
