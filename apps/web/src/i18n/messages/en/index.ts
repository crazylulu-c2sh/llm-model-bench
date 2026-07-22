import type { Messages } from "../ko";
import { common } from "./common";
import { header } from "./header";
import { bench } from "./bench";
import { results } from "./results";
import { scoreboard } from "./scoreboard";
import { stats } from "./stats";
import { stress } from "./stress";
import { monitor } from "./monitor";
import { docs } from "./docs";

// 도메인 누락/오타는 여기서 컴파일 에러. 도메인 내부 키 누락/초과는 각 도메인 파일의 타입 주석이 잡는다.
export const en: Messages = {
  common,
  header,
  bench,
  results,
  scoreboard,
  stats,
  stress,
  monitor,
  docs,
};
