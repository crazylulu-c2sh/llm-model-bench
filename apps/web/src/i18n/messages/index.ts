import type { Locale } from "../locale";
import { ko, type Messages } from "./ko";
import { en } from "./en";
import { ja } from "./ja";

export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { ko, en, ja };
