// ko = 진실의 원천. `Messages = typeof ko`가 en/ja의 타입 계약이 된다.
// 각 도메인은 `as const` 없이 평범한 리터럴로 작성 → 값이 string / (args) => string 으로 확장.
import { common } from "./common";
import { header } from "./header";
import { bench } from "./bench";
import { results } from "./results";
import { scoreboard } from "./scoreboard";
import { stats } from "./stats";
import { stress } from "./stress";
import { monitor } from "./monitor";
import { docs } from "./docs";

export const ko = {
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

export type Messages = typeof ko;
