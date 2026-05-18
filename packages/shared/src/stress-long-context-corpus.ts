/**
 * Long-context stress workload corpus — 3 languages.
 *
 * Goal: ~2500 input tokens per language (BPE/o200k_base 기준).
 * Topic: history of computing — natural, self-authored encyclopedic prose.
 * No external copyrighted material; safe to ship in repo.
 *
 * Token estimates (rough, cl100k_base):
 *   - EN: ~10,000 chars  ≈ 2,400–2,600 tokens
 *   - KO: ~3,700 chars   ≈ 2,300–2,600 tokens (CJK ~1.5 chars/tok)
 *   - JA: ~3,700 chars   ≈ 2,300–2,600 tokens
 *
 * If you adjust the prose, re-measure with `tiktoken` (cl100k_base or o200k_base)
 * or LM Studio's tokenizer endpoint to keep 2250 ≤ tokens ≤ 2750.
 */

export const LONG_CONTEXT_SYSTEM_EN =
  "You are a concise summarization assistant. Reply in exactly one short sentence.";

export const LONG_CONTEXT_SYSTEM_KO =
  "당신은 요약 어시스턴트입니다. 정확히 한 문장으로 짧게 답하세요.";

export const LONG_CONTEXT_SYSTEM_JA =
  "あなたは要約アシスタントです。正確に一文で短く答えてください。";

// ---------------- English (~2500 tokens) ----------------

export const LONG_CONTEXT_USER_EN = `The history of computing is a long arc that begins with simple mechanical aids for counting and ends, for now, with planet-scale distributed systems and large language models that read, write, and reason at speeds no human can match. Understanding this arc is useful because each generation of computing both inherits the constraints of the previous one and rewrites them, and the patterns of that rewriting tend to repeat at every layer of the stack, from individual transistors all the way up to global software ecosystems.

The earliest computing tools were physical objects: pebbles for tallying, knotted strings used by Andean civilizations, and the abacus that emerged in many cultures wherever trade required reliable arithmetic. These devices encoded numbers in positions, which is the same fundamental abstraction modern computers rely on, even though the underlying medium has changed from beads on rods to electrons trapped in silicon. The conceptual leap from a tool that helps you remember a number to a tool that performs operations on numbers came slowly. Mechanical calculators in the seventeenth century, built by figures like Blaise Pascal and Gottfried Wilhelm Leibniz, could add, subtract, and in some cases multiply through clever arrangements of gears, but they remained special-purpose devices that needed a human operator to interpret intermediate results.

The shift toward general-purpose machines is most often associated with Charles Babbage, who in the nineteenth century designed the Difference Engine for tabulating polynomial functions and the more ambitious Analytical Engine, which would have been programmable through punched cards in the manner of the Jacquard loom. Babbage never completed the Analytical Engine in his lifetime, but Ada Lovelace's commentary on it included what is widely considered the first algorithm intended for machine execution, along with the prescient observation that such a machine could process not only numbers but anything that could be encoded as symbols, including music. This insight prefigured the modern view of computation as the manipulation of arbitrary symbolic data.

The theoretical foundations were established in the twentieth century by Alonzo Church, Kurt Godel, and Alan Turing, who independently formalized what it means to compute. Turing's 1936 paper introduced the abstract machine that now bears his name, a model in which a head reads and writes symbols on an infinite tape according to a finite table of rules. The Turing machine is universal in the sense that it can simulate any other computational procedure, and this universality became the conceptual blueprint for general-purpose computers. During the Second World War, Turing also helped design machines at Bletchley Park to break German cipher systems, and similar wartime urgency drove the development of the ENIAC in the United States and the Z3 in Germany. These early electronic computers were room-sized, drew enormous power, and were programmed by physically rewiring components or feeding punched paper, but they could perform thousands of operations per second, which was unimaginable speed at the time.

The invention of the transistor at Bell Labs in 1947 by John Bardeen, Walter Brattain, and William Shockley made it possible to replace the bulky and unreliable vacuum tubes that dominated early machines with small solid-state switches. The integrated circuit, conceived independently by Jack Kilby and Robert Noyce in the late 1950s, packed many transistors onto a single piece of semiconductor. From there, Moore's Law, an empirical observation by Gordon Moore that the number of transistors on a chip doubled roughly every two years, drove decades of exponential growth in raw computing capacity. By the 1970s, this trend made it economically feasible to put a complete central processing unit on a single chip, the microprocessor, which is the foundation of every modern personal device.

The software side evolved in parallel. Early programs were written in machine code or assembly language, with developers manipulating raw memory addresses and processor instructions. The arrival of higher-level languages such as FORTRAN, COBOL, and LISP in the late 1950s and early 1960s introduced abstraction: programmers could now describe what they wanted the machine to do in terms closer to human thinking, and a compiler or interpreter would translate that description into machine instructions. Operating systems followed a similar trajectory, beginning as thin layers over the hardware and growing into multitasking, multi-user environments that managed memory, scheduling, and input output devices on behalf of application programs.

The personal computer era of the late 1970s and 1980s brought computation out of corporate basements and into homes, schools, and small businesses. Companies like Apple, IBM, and Commodore shipped machines that ordinary people could afford, and a generation of self-taught programmers learned to work with the limits of constrained memory and modest processors. The graphical user interface, popularized by the Macintosh and later Microsoft Windows, made computers approachable to users who would never write a line of code. Spreadsheets, word processors, and databases became the staple business applications, and the idea that every desk should have a computer became plausible.

Networking pushed the next transformation. The ARPANET project in the United States laid the conceptual and technical groundwork for packet-switched communication, which evolved into the global Internet. The web, invented by Tim Berners-Lee at CERN in 1989, layered a hyperlinked document system on top of the Internet and made publishing nearly free. By the late 1990s, businesses, governments, and individuals were all producing and consuming web content, and the search engine emerged as the primary way people navigated this rapidly expanding information space. Mobile computing followed in the 2000s as smartphones combined a computer, a camera, a sensor array, and a permanent network connection into a single pocket-sized device.

Data centers and cloud computing redistributed the previous decades of hardware progress. Instead of every organization buying and operating its own servers, cloud providers offered computation, storage, and networking as utilities, billed by the second. This made it possible to scale services from a single user to billions without owning the underlying hardware. At the same time, machine learning, which had been a quiet research field for decades, became enormously practical as GPUs originally designed for graphics turned out to be ideal for the parallel matrix operations that train neural networks. The convergence of large datasets, abundant compute, and improved algorithms produced systems that surpassed human performance in narrow domains like image classification, speech recognition, and certain board games.

The most recent chapter is dominated by large language models, transformer-based neural networks trained on enormous corpora of text and code. These systems can generate fluent prose, write functional programs, summarize documents, translate languages, and hold extended conversations, all from a single base architecture that was not explicitly designed for any one of these tasks. They have prompted renewed discussion of what computation is and what kinds of work it can replace or augment. They also strain the underlying infrastructure: training a frontier model consumes power and memory on scales that justify entirely new data center designs, and serving a model to many concurrent users requires careful orchestration of GPU memory, network bandwidth, and request queueing.

Throughout this entire history, certain themes recur. Abstraction layers grow until they begin to dominate the cost of using a system, at which point new tools emerge to manage them. Hardware improvements unlock software possibilities, and software demands drive hardware specialization. Centralization and decentralization alternate, with mainframes giving way to personal computers, which were then partly replaced by cloud-hosted services, which are now being reshaped by on-device inference. Every generation believes it is in the final mature phase, and every generation is wrong. The pace and direction of computing has always been shaped by what people can imagine doing with it, and that imagination has yet to slow down.

Based on the text above, summarize the core topic in exactly one short sentence.`;

// ---------------- 한국어 (~2500 tokens) ----------------

export const LONG_CONTEXT_USER_KO = `컴퓨팅의 역사는 단순한 셈 도구에서 시작해 오늘날의 행성 규모 분산 시스템과 대규모 언어 모델에 이르는 긴 호를 그린다. 이 흐름을 이해하는 일은 단순히 과거를 정리하는 작업을 넘어, 각 세대의 컴퓨팅이 이전 세대의 제약을 그대로 물려받으면서도 동시에 그 제약을 새로 다시 쓰는 패턴을 보여 주기 때문에 중요하다. 그리고 그 다시 쓰기의 패턴은 트랜지스터 한 개부터 전 세계 소프트웨어 생태계까지 모든 추상화 계층에서 비슷한 모양으로 반복된다.

가장 초기의 컴퓨팅 도구는 단순한 물리적 사물이었다. 셈을 위해 사용한 조약돌, 안데스 문명에서 사용한 매듭 끈, 그리고 무역이 신뢰할 수 있는 산술을 요구할 때마다 여러 문화권에서 독립적으로 등장한 주판이 그 예다. 이 도구들은 모두 위치값으로 수를 표현했고, 그 추상은 표현 매체가 막대 위 구슬에서 실리콘 속 전자로 바뀐 지금의 컴퓨터에서도 본질적으로 동일하게 살아남아 있다. 다만 수를 기억하는 도구에서 수에 연산을 수행하는 도구로 넘어가는 개념적 도약은 오래 걸렸다. 17세기 파스칼과 라이프니츠 같은 인물이 만든 기계식 계산기는 톱니바퀴를 정교하게 배열해 덧셈, 뺄셈, 일부는 곱셈까지 처리했지만 여전히 중간 결과를 사람이 직접 해석해야 하는 특수 목적 장치였다.

범용 기계로의 전환은 보통 19세기의 찰스 배비지와 연결된다. 그는 다항식 표를 만들기 위한 차분 기관과, 자카드 직조기처럼 천공 카드로 프로그래밍할 수 있는 더 야심 찬 해석 기관을 설계했다. 배비지 자신은 해석 기관을 완성하지 못했지만, 그 기계에 관한 에이다 러브레이스의 주석에는 기계 실행을 의도한 최초의 알고리즘으로 평가되는 절차가 포함되었고, 동시에 기계가 단순한 수뿐 아니라 음악을 포함해 기호로 표현할 수 있는 무엇이든 다룰 수 있다는 통찰이 담겨 있었다. 이 직관은 임의의 기호 데이터를 다루는 일이 곧 계산이라는 현대적 시각을 선취한 것이었다.

이론적 토대는 20세기에 알론조 처치, 쿠르트 괴델, 앨런 튜링이 독립적으로 정립했다. 1936년 튜링의 논문은 오늘날 그의 이름을 딴 추상 기계를 제시했는데, 무한한 테이프 위에서 헤드가 유한한 규칙표에 따라 기호를 읽고 쓰는 모델이었다. 튜링 기계는 다른 어떤 계산 절차도 흉내 낼 수 있다는 의미에서 보편적이며, 이 보편성은 이후 범용 컴퓨터의 개념적 청사진이 되었다. 제2차 세계대전 중에는 튜링이 블레츨리 파크에서 독일 암호 시스템을 해독하는 기계 설계에 관여했고, 비슷한 전시의 다급함이 미국의 에니악과 독일의 Z3 같은 초기 전자식 컴퓨터의 개발을 추진했다. 이 기계들은 방 하나를 가득 채우고 막대한 전력을 먹었으며 부품을 다시 배선하거나 천공 종이를 먹여 프로그래밍해야 했지만, 초당 수천 번의 연산이 가능했고 당시로서는 상상하기 어려운 속도였다.

1947년 벨 연구소의 바딘, 브래튼, 쇼클리가 트랜지스터를 발명하면서, 초기 기계를 지배하던 거대하고 불안정한 진공관을 작고 견고한 반도체 스위치로 대체할 길이 열렸다. 1950년대 후반에는 잭 킬비와 로버트 노이스가 독립적으로 집적 회로를 고안해 다수의 트랜지스터를 단일 반도체 조각에 담아냈다. 이후 칩에 들어가는 트랜지스터 수가 약 2년마다 두 배로 늘어난다는 고든 무어의 경험적 관찰, 이른바 무어의 법칙은 수십 년에 걸친 연산 능력의 지수적 성장을 이끌었다. 1970년대에 이르러 중앙처리장치 전체를 한 칩에 담는 마이크로프로세서가 경제성을 갖추었고, 이는 오늘날의 모든 개인 기기의 기초가 되었다.

소프트웨어 또한 같은 흐름을 따라 진화했다. 초기 프로그램은 기계어나 어셈블리어로 작성되어 개발자가 메모리 주소와 명령을 직접 다뤄야 했다. 1950년대 말부터 1960년대 초에 등장한 포트란, 코볼, 리스프 같은 고급 언어는 추상화를 가져왔다. 프로그래머가 사람의 사고에 가까운 표현으로 의도를 적으면 컴파일러나 인터프리터가 이를 기계 명령으로 옮기게 된 것이다. 운영체제 역시 하드웨어 위의 얇은 층에서 시작해, 응용 프로그램을 대신해 메모리, 스케줄링, 입출력을 관리하는 다중 작업·다중 사용자 환경으로 자라났다.

1970년대 후반부터 1980년대까지 이어진 개인용 컴퓨터의 시대는 컴퓨팅을 기업 지하실에서 가정, 학교, 작은 사업장으로 끌어냈다. 애플, IBM, 코모도어 같은 회사들이 평범한 사람도 부담할 수 있는 기계를 내놓았고, 좁은 메모리와 수수한 프로세서의 제약 안에서 일하는 법을 스스로 익힌 한 세대의 프로그래머가 등장했다. 매킨토시와 이후의 마이크로소프트 윈도우가 대중화한 그래픽 사용자 인터페이스는 한 줄의 코드도 작성해 본 적 없는 사람들에게 컴퓨터를 친근한 도구로 만들었다. 스프레드시트, 워드 프로세서, 데이터베이스가 업무용 핵심 응용이 되었고, 모든 책상에 컴퓨터 한 대씩이라는 발상이 현실에 가까워졌다.

네트워크는 그다음의 변신을 밀어붙였다. 미국의 ARPANET 프로젝트는 패킷 교환 통신의 개념적·기술적 토대를 깔았고, 이는 전 세계적인 인터넷으로 자라났다. 1989년 CERN의 팀 버너스리가 발명한 웹은 인터넷 위에 하이퍼링크로 연결된 문서 시스템을 얹어 출판 비용을 거의 0에 가깝게 떨어뜨렸다. 1990년대 후반에는 기업, 정부, 개인이 모두 웹 콘텐츠를 만들고 소비하기 시작했고, 검색 엔진이 이 폭증하는 정보 공간을 항행하는 가장 중요한 도구로 떠올랐다. 2000년대에는 스마트폰이 컴퓨터, 카메라, 센서 묶음, 상시 네트워크를 한 손바닥 크기 기기에 통합하면서 모바일 컴퓨팅의 시대가 열렸다.

데이터 센터와 클라우드 컴퓨팅은 앞선 수십 년의 하드웨어 발전을 다시 한번 재배치했다. 모든 조직이 직접 서버를 사고 운영하는 대신, 클라우드 사업자가 연산, 저장, 네트워크를 초 단위로 과금되는 유틸리티처럼 제공했다. 그 덕분에 한 명의 사용자에서 수십억 명의 사용자로 확장되는 서비스를 하부 하드웨어를 소유하지 않고도 운영할 수 있게 되었다. 같은 시기에 오랜 연구 분야였던 머신러닝은 본격적으로 실용 단계에 들어섰는데, 그래픽 처리를 위해 설계된 GPU가 신경망을 학습시키는 데 필요한 병렬 행렬 연산에 매우 잘 맞는다는 사실이 결정적이었다. 풍부한 데이터, 충분한 연산, 개선된 알고리즘이 한데 모이자 이미지 분류, 음성 인식, 일부 보드 게임 같은 좁은 영역에서 인간 성능을 넘어서는 시스템이 등장했다.

가장 최근의 장은 대규모 언어 모델, 즉 방대한 텍스트와 코드 말뭉치로 학습된 트랜스포머 기반 신경망이 주도하고 있다. 이 시스템들은 유창한 산문을 생성하고, 동작 가능한 프로그램을 짜고, 문서를 요약하고, 언어를 번역하고, 긴 대화를 이어 가며, 그 모든 일을 어느 한 작업을 위해 특별히 설계되지 않은 단일 기반 구조 위에서 해낸다. 이러한 시스템은 계산이란 무엇이고 어떤 일을 대체하거나 보조할 수 있는가에 대한 새로운 논의를 불러일으켰다. 동시에 이들은 하부 인프라에 큰 부담을 준다. 최전선 모델을 학습하려면 새로운 데이터 센터 설계를 정당화할 정도의 전력과 메모리가 필요하고, 동시에 많은 사용자에게 모델을 서비스하려면 GPU 메모리, 네트워크 대역폭, 요청 큐를 세심하게 조율해야 한다.

이 전체 흐름에서 몇 가지 주제가 반복된다. 추상화 계층은 사용 비용을 압도할 만큼 두꺼워지고, 그러면 다시 새로운 도구가 등장해 그 계층을 다스린다. 하드웨어의 발전은 소프트웨어의 가능성을 열고, 소프트웨어의 요구는 하드웨어의 전문화를 끌어낸다. 집중과 분산은 번갈아 가며 자리를 바꾼다. 메인프레임이 개인용 컴퓨터에 자리를 내주고, 그 자리는 다시 클라우드 호스팅 서비스에 일부 양보되었으며, 이제는 기기 안에서 직접 추론하는 흐름이 다시 그 풍경을 바꾸고 있다. 모든 세대는 자신이 마지막 성숙기에 들어섰다고 믿지만, 모든 세대는 그렇지 않았다. 컴퓨팅의 속도와 방향은 언제나 사람들이 그것으로 무엇을 하고 싶은가에 따라 모양이 잡혀 왔고, 그 상상력은 아직 멈추지 않았다.

위 본문의 핵심 주제를 정확히 한 문장으로 요약하세요.`;

// ---------------- 日本語 (~2500 tokens) ----------------

export const LONG_CONTEXT_USER_JA = `コンピューティングの歴史は、単純な計数の道具から始まり、現在は惑星規模の分散システムや、人間が追いつけない速度で読み書きし推論する大規模言語モデルにまで及ぶ長い弧を描いている。この流れを理解することには意味がある。各世代のコンピューティングは前世代の制約を引き継ぎつつも同時にその制約を書き換え、しかもその書き換えのパターンは、個々のトランジスタから世界規模のソフトウェア生態系に至るまで、すべての抽象化層で同じ形を繰り返すからである。

最初期のコンピューティング道具は単純な物理的存在だった。計数のための小石、アンデス文明が使った結縄、そして信頼できる算術が交易に必要となった文化圏で繰り返し独立に生まれた算盤などである。これらの道具はいずれも位取りによって数を表現しており、その抽象は媒体が棒上の珠から珪素の中の電子に変わった現在のコンピュータでも本質的に生き残っている。ただし、数を覚えるための道具から数に演算を施す道具への概念的飛躍はゆっくりと進んだ。17世紀のパスカルやライプニッツが作った機械式計算機は、巧妙に並べた歯車で加減算、場合によっては乗算までこなしたが、中間結果を人間が直接読み解く必要のある特殊目的の装置に留まっていた。

汎用機械への転換は通常、19世紀のチャールズ・バベッジと結び付けられる。彼は多項式表を作るための階差機関と、ジャカード織機のように穿孔カードでプログラム可能な、より野心的な解析機関を設計した。バベッジ自身は解析機関を完成できなかったが、その機械についてのエイダ・ラブレスの注釈には、機械実行を意図した最初のアルゴリズムと評される手順が含まれており、加えて、機械は単なる数だけでなく音楽を含めて記号として表せるものなら何でも扱える、という洞察も記されていた。この直観は、任意の記号データを操作することが計算であるという現代的な見方を先取りしていた。

理論的基盤は20世紀にアロンゾ・チャーチ、クルト・ゲーデル、アラン・チューリングがそれぞれ独立に確立した。1936年のチューリングの論文は、いまや彼の名で呼ばれる抽象機械を提示した。それは、無限のテープ上をヘッドが有限の規則表に従って記号を読み書きするモデルである。チューリング機械は他のどんな計算手続きも模倣できるという意味で普遍的であり、この普遍性はその後の汎用コンピュータの概念的青写真となった。第二次世界大戦中には、チューリングはブレッチリー・パークでドイツの暗号体系を解読する機械の設計に関わり、似たような戦時の切迫感は米国のENIACやドイツのZ3といった初期の電子式コンピュータの開発を推し進めた。これらの機械は部屋一つを占有し、莫大な電力を消費し、部品を組み直したり穿孔紙を入れたりしてプログラムする必要があったが、毎秒数千回の演算が可能で、当時としては想像し難い速度だった。

1947年にベル研究所のバーディーン、ブラッテン、ショックレーがトランジスタを発明したことで、初期の機械を支配していた巨大で不安定な真空管を、小型で堅牢な半導体スイッチに置き換える道が開けた。1950年代後半には、ジャック・キルビーとロバート・ノイスが独立に集積回路を考案し、複数のトランジスタを一枚の半導体に収めた。以降、チップ上のトランジスタ数がおおむね二年で二倍になるというゴードン・ムーアの経験的観察、いわゆるムーアの法則が、数十年にわたる演算能力の指数的成長を駆動した。1970年代になると、中央処理装置全体を一つのチップに収めるマイクロプロセッサが経済的に成立し、これが現代のあらゆる個人機器の土台となった。

ソフトウェアも同じ流れに沿って進化した。初期のプログラムは機械語やアセンブリ言語で書かれ、開発者はメモリアドレスと命令を直接扱う必要があった。1950年代末から1960年代初頭にかけて登場したFORTRAN、COBOL、LISPといった高級言語は抽象化をもたらした。プログラマが人間の思考に近い表現で意図を記述すれば、コンパイラやインタプリタがそれを機械命令に翻訳するようになったのである。オペレーティングシステムも同様に、ハードウェア上の薄い層から始まり、アプリケーションに代わってメモリ、スケジューリング、入出力を管理する多重処理・多人数環境へと成長した。

1970年代後半から1980年代の個人用コンピュータの時代は、計算を企業の地下室から家庭、学校、小規模事業所へ連れ出した。アップル、IBM、コモドールといった企業が一般の人々にも手の届く機械を出荷し、限られたメモリと控えめなプロセッサの制約の中で働く方法を独学で身につけた一世代のプログラマが現れた。マッキントッシュやのちのマイクロソフトWindowsが普及させたグラフィカルユーザーインターフェースは、一行もコードを書いたことのない利用者にも計算機を親しみやすい道具にした。表計算ソフト、ワードプロセッサ、データベースが業務用の中核アプリケーションとなり、すべての机に一台の計算機という発想が現実味を帯びた。

ネットワークは次の変容を後押しした。米国のARPANETプロジェクトはパケット交換通信の概念的・技術的基盤を築き、それは世界規模のインターネットへと成長した。1989年にCERNのティム・バーナーズリーが発明したウェブは、インターネットの上にハイパーリンクで結ばれた文書システムを重ね、出版の費用をほぼ無に近づけた。1990年代後半には、企業、政府、個人のすべてがウェブの内容を作りまた消費するようになり、検索エンジンが急速に拡大する情報空間を航行する主たる手段となった。2000年代にはスマートフォンが、計算機、カメラ、センサ群、常時接続ネットワークを手のひらサイズの機器に統合し、モバイルコンピューティングの時代を開いた。

データセンターとクラウドコンピューティングは、先行する数十年のハードウェア進歩を改めて再配置した。すべての組織が自分でサーバを買い運用する代わりに、クラウド事業者が計算、保管、ネットワークを秒単位で課金される公共設備のように提供したのである。これにより、一人の利用者から数十億人の利用者へとスケールするサービスを、下層のハードウェアを所有せずに運用できるようになった。同じ時期、長年地味な研究領域だった機械学習が一気に実用域に入った。鍵となったのは、グラフィックス用に設計されたGPUが、神経網の学習に必要な並列行列演算に極めて適していたという事実である。豊富なデータ、潤沢な演算、改良された算法が結びついた結果、画像分類、音声認識、いくつかのボードゲームなどの狭い領域では人間の性能を上回るシステムが現れた。

最も最近の章は、膨大なテキストとコードの集積で学習されたトランスフォーマー基盤の神経網、すなわち大規模言語モデルが主導している。これらの系は流暢な散文を生成し、動作する算譜を書き、文書を要約し、言語を翻訳し、長い対話を保つことができ、しかもそのすべてを、どれか一つの作業のために特別に設計されたわけではない単一の基盤構造の上で行う。これらは計算とは何であり、どんな仕事を置き換えたり補ったりできるのかという議論を改めて呼び起こした。同時に、これらは下層の設備に大きな負荷をかける。最前線の模型を学習させるには、まったく新しいデータセンター設計を正当化するほどの電力と記憶が要り、多数の同時利用者に模型を提供するには、GPUの記憶、網の帯域、要求の待ち行列を緻密に整える必要がある。

この一連の流れを通して、いくつかの主題が繰り返し現れる。抽象化の層は、その利用費用を支配するほど厚くなり、すると新しい道具がその層を制御するために登場する。ハードウェアの進歩はソフトウェアの可能性を開き、ソフトウェアの要求はハードウェアの専門化を駆動する。集中と分散は交互に入れ替わる。メインフレームは個人用コンピュータに席を譲り、その席は今度はクラウド上の業務に部分的に明け渡され、いまは機器内推論の流れがその風景を再び塗り替えつつある。どの世代も自分が最終の成熟期に入ったと信じるが、どの世代もそうではなかった。計算の速度と方向はつねに、人々がそれで何をしたいかという想像力によって形作られてきたし、その想像力はいまだ衰えていない。

上記本文の核心テーマを正確に一文で要約してください。`;
