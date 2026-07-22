import type { LlmProfileFamily, SamplingPresetName } from "@llm-bench/shared";
import type { ReactNode } from "react";

/**
 * 프리셋 카드 하나의 서술 텍스트(패밀리 무관, 로케일별).
 * `refs`(참고 패밀리 목록)는 언어 중립 데이터라 ProfileDocPage의 PRESET_REFS로 분리한다.
 */
export type PresetDescriptionContent = {
  /** 언제 이 프리셋이 선택되는가 */
  when: ReactNode;
  /** 무엇을 위한 프리셋인가 */
  intent: ReactNode;
  /** 예시 시나리오(불릿 텍스트) */
  examples: string[];
};

/**
 * ProfileDocPage의 모든 산문·섹션 헤딩을 로케일별로 담는 콘텐츠 계약.
 * 레이아웃/구조/앵커/데이터 반복은 ProfileDocPage.tsx에 남고, 사람이 읽는 텍스트만 여기로 나온다.
 * ko/en/ja 세 모듈이 이 타입을 정확히 만족(같은 키)해야 한다.
 */
export type ProfileDocContent = {
  // 인트로 섹션
  docTitle: ReactNode;
  intro: ReactNode;

  // 자동 프로파일 추론
  autoInferHeading: ReactNode;
  autoInfer: ReactNode;

  // 사고 블록 인식·제거 (id="thinking-block-strip")
  thinkingBlockStripHeading: ReactNode;
  thinkingBlockStrip: ReactNode;

  // LM Studio 호스트 설정 (id="lmstudio-host")
  lmstudioHostHeading: ReactNode;
  lmstudioHost: ReactNode;

  // 런타임 적용(벤치 요청)
  runtimeApplyHeading: ReactNode;
  runtimeApply: ReactNode[];
  runtimeExampleSummary: ReactNode;

  // 프리셋 설명
  presetSectionHeading: ReactNode;
  presetIntro: ReactNode[];
  presetCardLabels: {
    when: ReactNode;
    intent: ReactNode;
    examples: ReactNode;
    refs: ReactNode;
  };
  presetDescriptions: Record<SamplingPresetName, PresetDescriptionContent>;

  // 런타임 노트(패밀리별) + 헤딩
  runtimeNotesHeading: ReactNode;
  runtimeNotes: Partial<Record<LlmProfileFamily, ReactNode[]>>;

  // 패밀리 카드 라벨
  promptRulesHeading: ReactNode;
  samplingTableHeading: ReactNode;
  familyMatchLabel: ReactNode;
  promptRules: {
    gemmaThinkToken: string;
    stripThinkingFromHistory: string;
    none: string;
  };

  // unknown 패밀리 (id="unknown")
  unknownFamilyHeading: ReactNode;
  unknownFamily: ReactNode;
};
