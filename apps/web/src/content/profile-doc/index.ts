import type { Locale } from "../../i18n";
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import type { ProfileDocContent } from "./types";

export type { ProfileDocContent, PresetDescriptionContent } from "./types";

export const PROFILE_DOC_CONTENT: Record<Locale, ProfileDocContent> = { ko, en, ja };
