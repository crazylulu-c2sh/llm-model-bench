각 프롬프트는 이미지의 목적(벤치마크)을 명확히 하고, 생성 모델이 텍스트(OCR)와 복잡한 구조를 정확히 묘사할 수 있도록 구체적으로 설계했습니다.

---

### 멀티모달 벤치마크용 이미지 생성 프롬프트 5선

#### 1. 심화 OCR: 복잡한 표 구조화 (Complex Table Structure)

**목적:** 병합된 셀, 다른 폰트 크기, 선 없음 등 까다로운 표 구조 인식 및 포맷 변환 능력 테스트.

> **Prompt (영어):**
> A high-resolution photo of a physical document pages, a complex, formal financial table from a corporate annual report. The table is crowded with text. It must include several merged cells spanning multiple columns and rows. Sample columns: "Metric," "2023 Actual," "2024 Projected," "2024 Actual," "YoY Change (%)". Sample rows include "Revenue," "Operating Cost," "R&D Expense," and sub-metrics. All numbers (e.g., $1,234.56, -12.3%, 98.7) must be clearly legible but dense. Some borders are omitted, relying on text alignment. The lighting is slightly uneven, and the paper has a subtle texture.

* **포인트:** 실제 연차 보고서처럼 보이도록 하며, 병합된 셀("merged cells"), 다양한 수치 포맷($1,234.56, -12.3%), 그리고 일부 선 생략("Some borders are omitted")을 명시하여 모델의 구조 파악 능력을 테스트합니다.

#### 2. 공간 지각: 밀집된 객체 카운팅 (Dense Object Counting)

**목적:** 밀집된 환경에서 환각(Hallucination) 없이 정확한 개수를 세는지 테스트.

> **Prompt (영어):**
> A high-resolution, overhead aerial photograph of an extremely crowded outdoor parking lot during a busy weekend. Thousands of cars are tightly packed, but small and clear. The task is to generate a diverse array of cars of all colors. Specifically, ensure there is a clear, countable number of bright red cars (e.g., approximately 15-20) scattered throughout the vast field of other cars (mostly grey, white, black). The image must be sharp, allowing one to distinguish individual vehicle forms.

* **포인트:** 항공 사진("overhead aerial photograph"), "Thousands of cars", 그리고 핵심 테스트 대상인 "countable number of bright red cars"를 명시하여, 모델이 전체적인 맥락과 함께 미세한 대상을 구분하고 세는 능력을 평가하도록 합니다.

**생성 에셋 (동일 프롬프트, 서로 다른 이미지 생성기):**

| 생성기 | 파일 | 해상도 | 정답(밝은 빨간 차) |
|--------|------|--------|-------------------|
| ChatGPT (DALL·E) | [`ChatGPT Image 공간 지각 밀집된 객체 카운팅 (Dense Object Counting).png`](./ChatGPT%20Image%20%EA%B3%B5%EA%B0%84%20%EC%A7%80%EA%B0%81%20%EB%B0%80%EC%A7%91%EB%90%9C%20%EA%B0%9D%EC%B2%B4%20%EC%B9%B4%EC%9A%B4%ED%8C%85%20(Dense%20Object%20Counting).png) | 1536×1024 | **31~37** (`vision_count_red_cars_a`) |
| Gemini | [`Gemini_Generated_Image 공간 지각 밀집된 객체 카운팅 (Dense Object Counting).png`](./Gemini_Generated_Image%20%EA%B3%B5%EA%B0%84%20%EC%A7%80%EA%B0%81%20%EB%B0%80%EC%A7%91%ED%90%9C%20%EA%B0%9D%EC%B2%B4%20%EC%B9%B4%EC%9A%B4%ED%8C%85%20(Dense%20Object%20Counting).png) | 2816×1536 | **40~48** (`vision_count_red_cars_b`) |

정답은 “밝은 빨간색(bright red)” 승용차만 센 값이며, 주차장 전체 차량 수는 세지 않습니다. ChatGPT 이미지(`vision_count_red_cars_a`)는 인간 수동 카운트 기준 **31~37**입니다. Gemini 이미지(`vision_count_red_cars_b`)는 프롬프트의 15–20대보다 훨씬 많은 빨간 차가 생성되었으며, v1.2 출하 정답은 인간 수동 카운트 기준 **40~48대**입니다. 초기 자동 스크립트 추정(58/~68)은 폐기되었습니다.

**VLM 평가 질문 (권장):**

> **Prompt (영어):** In this overhead parking-lot image, how many bright red cars can you see? Count only clearly visible bright red vehicles; do not guess hidden cars. Reply with a single integer and one short sentence explaining your method.

> **Prompt (한국어):** 이 항공 주차장 사진에서 밝은 빨간색 차는 몇 대입니까? 분명히 보이는 밝은 빨간 승용차만 세고, 가려진 차는 추정하지 마세요. 정수 하나와 짧은 설명 한 문장으로 답하세요.

**채점:** 정답과 **정확히 일치** 또는 합의된 허용 오차(예: ±2) — 이미지별로 정답 표를 따릅니다. 과대/과소 추정·회색·주황을 빨강으로 오인하는 경우를 로그에 남깁니다.

**생성 프롬프트 준수도 메모:** 두 생성기 모두 “countable number … approximately 15–20” 지시를 잘 따르지 않았습니다(ChatGPT **31~37**, Gemini **40~48**). 정확한 개수가 중요하면 `exactly N bright red cars`처럼 숫자를 고정하거나, 생성 후 스크립트·육안으로 개수를 검증한 뒤 벤치에 포함하세요.

#### 3. 논리적 추론: 복잡한 차트 해석 (Complex Chart Interpretation)

**목적:** 다중 범례, 축 레이블, 데이터 포인트 간의 관계를 정확히 읽고 추론하는 능력 테스트.

> **Prompt (영어):**
> A professional, complex data visualization chart, a multi-line graph with five different lines. Each line represents a different product (Product A, B, C, D, E) and uses a unique color and marker shape. The vertical Y-axis is "Market Share (%)" from 0-100%, and the horizontal X-axis is "Quarter" (e.g., Q1 2023, Q2 2023, ... Q4 2024). All axis labels, grid lines, and a clear legend must be present. The lines intersect at various points. A specific, tricky data point is a peak for Product C that is very close to but distinct from Product A's peak.

* **포인트:** 다중 선 그래프("multi-line graph with five lines"), 명확한 범례와 축 레이블("axis labels, grid lines, and a clear legend"), 그리고 데이터 간의 미세한 차이("tricky data point")를 포함하여 실제 데이터 분석 능력을 테스트합니다.

#### 4. 논리적 추론: 유머 및 밈 이해 (Humor & Meme Understanding)

**목적:** 텍스트와 이미지의 불일치 또는 문화적 맥락(Meme)을 이해하고 설명하는 능력 테스트.

> **Prompt (영어):**
> An internet-style meme image, high-quality, split into two panels.
> Panel 1 (Top): A detailed, realistic photo of a powerful, modern computer server rack in a clean data center. Overlaid text says "WHAT LLMS PROMISE:".
> Panel 2 (Bottom): A humorous, stylized photo of a medieval, rustic cart being pulled by a single, tired-looking, small donkey, struggling on a dirt path. Overlaid text says "WHAT MY PC ACTUALLY PRODUCES:". The overall aesthetic is humorous and self-deprecating.

* **포인트:** 두 개의 패널로 분할된 밈 형식("two panels"), 상반된 이미지(서버 랙 vs 당나귀 수레), 그리고 핵심 텍스트를 명시하여 모델이 두 가지 상반된 정보 간의 유머러스한 관계를 이해하는지 테스트합니다.

#### 5. 코드 생성: 와이어프레임 렌더링 (Wireframe to Code)

**목적:** 시각적 와이어프레임의 레이블, 레이아웃, 계층 구조를 이해하고 코드로 변환하는 능력 테스트.

> **Prompt (영어):**
> A high-resolution photograph of a hand-drawn website wireframe sketched in black marker on a whiteboard. It must look like a rough, early-stage sketch. Clearly labeled sections with hand-written text: "Header" (with "Logo," "Nav"), "Hero Section" (with "Headline," "CTA Button"), "Features Grid" (with "Feature 1," "Feature 2," "Feature 3"), "Testimonials," and "Footer." Place small, clear labels on buttons like "Sign Up" or "Learn More." The whiteboard has smudges.

* **포인트:** "hand-drawn wireframe sketched in black marker on a whiteboard"로 시나리오를 설정하고, 모든 주요 섹션("Header", "Features Grid" 등)과 버튼 텍스트("Sign Up")를 명확한 손글씨("hand-written text") 레이블로 포함하도록 명시합니다.

---

> **이미지 생성 시 참고사항:**
> * DALL-E 3나 Midjourney v6와 같은 최신 모델을 사용하는 것이 OCR과 복잡한 구조 묘사에 유리합니다.
> * 특히 OCR 파트는 텍스트 생성의 정확도가 중요하므로, 모델이 생성한 이미지를 한 번 더 검증하는 과정이 필요합니다.
> 
>