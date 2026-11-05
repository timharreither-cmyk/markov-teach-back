// =====================================================================
// content.js: everything the participant reads and everything Sam is told.
// Edit texts here; the app logic lives in app.jsx.
// Notation follows the learning material (LibreTexts 10.1): T = transition
// matrix, V0 = initial state vector, Vn = V0·T^n, rows = current state.
// All numbers below were checked with numpy.
// =====================================================================

window.STUDY = {
  version: "2.0",

  // ---------------------------------------------------------------
  // Shared example the student teaches with (Topics 1-3).
  // Deliberately different from the material (bikes, TV) and from the
  // pre/post tests (weather, TV, robot vacuum, streaming).
  // The graph and matrix are NOT shown: building them is Topics 1-2.
  // ---------------------------------------------------------------
  catProblem: {
    title: "Example: Miso the cat",
    text:
`Every hour, Miso the cat is either Sleeping (S), Eating (E) or Playing (P).
• After an hour of sleeping, Miso keeps sleeping with probability 0.6, goes eating with probability 0.3, and otherwise plays.
• Miso never eats two hours in a row. After eating, Miso falls asleep with probability 0.4 and otherwise plays.
• After playing, Miso falls asleep with probability 0.3, goes eating with probability 0.2, and otherwise keeps playing.
At noon there is a 50% chance that Miso is sleeping and a 50% chance that Miso is playing.`,
    // Ground truth, given to Sam only.
    solution:
`States S, E, P (in this order).
Graph: 8 arrows. S→S 0.6, S→E 0.3, S→P 0.1; E→S 0.4, E→P 0.6 (no E→E arrow, probability 0); P→S 0.3, P→E 0.2, P→P 0.5.
Transition matrix T (rows = now, columns = next hour):
      S    E    P
S  [0.6  0.3  0.1]
E  [0.4  0.0  0.6]
P  [0.3  0.2  0.5]
Every row sums to 1.
Initial state vector at noon: V0 = [0.5  0  0.5].
After 1 hour: V1 = V0·T = [0.45  0.25  0.30].
After 2 hours: V2 = V1·T = V0·T² = [0.46  0.195  0.345].
T² = T·T = [[0.51 0.20 0.29],[0.42 0.24 0.34],[0.41 0.19 0.40]].`
  },

  // ---------------------------------------------------------------
  // Topics 1-3 (section 6.1.1 of the documentation)
  // rubric = hidden checklist Sam uses to judge the explanation.
  // reference = correct methodology, shown by Sam on REVEAL and used as
  // fallback text if the model ever fails to reveal.
  // ---------------------------------------------------------------
  topics: [
    {
      id: "T1",
      title: "Transition probability graph",
      task: "Explain to Sam how to construct the transition probability graph (arrow diagram) for a Markov chain problem. You can use Miso the cat as your example.",
      opener: "Hi! I missed the lecture on Markov chains and I have to draw a \"transition graph\" for Miso the cat. I honestly don't know where to start. How do I build one?",
      rubric: [
        { id: "g1", text: "Draw one node (circle) for each state of the system (here S, E, P)." },
        { id: "g2", text: "Draw a directed arrow from state i to state j for each transition that can happen in one step, and label it with the probability of going from i to j in one step." },
        { id: "g3", text: "Staying in the same state is also a transition: draw a self-loop with its probability (e.g. S→S 0.6)." },
        { id: "g4", text: "Transitions with probability 0 get no arrow (e.g. no E→E loop)." },
        { id: "g5", text: "The probabilities on the arrows leaving a state add up to 1, so a missing 'otherwise' probability is 1 minus the others." }
      ],
      reference:
`Here is how I understand it now: draw one circle for every state (S, E, P). Then, for every state, ask "where can it go in one step?" and draw an arrow to each possible next state, labelled with that one-step probability. Staying put is also a step, so it gets a loop (S→S 0.6). If a transition is impossible (probability 0, like eating twice in a row), there is no arrow. The arrows leaving each state must add up to 1, which also lets you fill in an "otherwise" value: S→P = 1 − 0.6 − 0.3 = 0.1. For Miso that gives 8 arrows.`
    },
    {
      id: "T2",
      title: "Transition matrix",
      task: "Explain to Sam how to construct the transition matrix for a Markov chain problem. You can use Miso the cat as your example.",
      opener: "Thanks, I think I get the graph now! My notes also say I need a \"transition matrix\" T. How do I turn the situation (or the graph) into a matrix?",
      rubric: [
        { id: "m1", text: "T is a square n×n matrix with one row and one column per state, using the same order of states for rows and columns." },
        { id: "m2", text: "The entry in row i, column j is the probability of moving from state i (current) to state j (next) in one step." },
        { id: "m3", text: "Every row sums to 1 and all entries are between 0 and 1 (columns do not have to sum to 1)." },
        { id: "m4", text: "Impossible transitions are entered as 0; the matrix contains exactly the same information as the graph (one entry per possible arrow)." }
      ],
      reference:
`So: pick an order for the states, say S, E, P, and use it for both rows and columns. Row = where the chain is now, column = where it goes next. The entry in row i, column j is the one-step probability from i to j, i.e. the label of the arrow i→j, and 0 if there is no arrow. For Miso: row S = [0.6 0.3 0.1], row E = [0.4 0 0.6], row P = [0.3 0.2 0.5]. Each row is a full "where can I go from here" list, so each row sums to 1. The columns don't have to.`
    },
    {
      id: "T3",
      title: "State vector after n transitions",
      task: "Explain to Sam how to find the state vector (the distribution) after a given number of transitions, using the transition matrix and the initial state vector. A small example helps.",
      opener: "Last part! The exercise asks: where is Miso likely to be at 2 pm, if at noon it's 50% sleeping and 50% playing? I have the matrix T now, but how do I get from noon to 2 pm?",
      rubric: [
        { id: "s1", text: "The initial state vector V0 is a row vector with the probability of being in each state at the start (same order as T); its entries sum to 1. Here V0 = [0.5 0 0.5]." },
        { id: "s2", text: "One transition: V1 = V0·T (row vector times matrix). Entry j of V1 is the sum over i of V0_i · T_ij, i.e. the law of total probability over where the chain was before." },
        { id: "s3", text: "n transitions: multiply n times, Vn = V(n-1)·T = V0·T^n, where T^n is a matrix product (T·T·…), NOT the entries raised to the power n." },
        { id: "s4", text: "Sanity check: every state vector still sums to 1. For Miso at 2 pm (2 steps): V2 = [0.46 0.195 0.345]." }
      ],
      reference:
`Got it, I think: write the start as a row vector in the same state order as T, V0 = [0.5 0 0.5]. One hour later is V1 = V0·T: for each next state j you add up "probability of being in i" times "probability of going i→j" over all i (law of total probability). That gives V1 = [0.45 0.25 0.30]. For two hours, do it again: V2 = V1·T = [0.46 0.195 0.345]. In general Vn = V0·T^n, where T^n means multiplying the matrix by itself n times. Squaring each entry is NOT the same. Each vector must still sum to 1.`
    }
  ],

  // ---------------------------------------------------------------
  // Error detection (section 6.1.2): fixed problem with exactly two
  // planted mistakes. The control group sees the same problem with the
  // solution (section 6.2.1).
  // ---------------------------------------------------------------
  errorTask: {
    title: "Sam's attempt: commuting",
    problem:
`Each day, commuters in a town travel by Bus (B), Car (C) or Train (T).
• Of today's bus riders, 70% take the bus again tomorrow, 20% switch to the car and 10% to the train.
• Of today's car drivers, 10% switch to the bus, 80% drive again and 10% switch to the train.
• Of today's train riders, 20% switch to the bus, nobody switches to the car, and the rest take the train again.
Today 50% take the bus, 30% the car and 20% the train. What is the distribution after 2 days?`,
    faultySolution:
`Step 1: transition matrix (order B, C, T):
      B    C    T
B  [0.7  0.2  0.1]
C  [0.1  0.8  0.1]
T  [0.2  0.8  0.0]

Step 2: two days = two steps, so I square the matrix by squaring every entry:
      B     C     T
B  [0.49  0.04  0.01]
C  [0.01  0.64  0.01]
T  [0.04  0.64  0.00]

Step 3: V2 = V0·T² = [0.5 0.3 0.2]·T² = [0.256  0.340  0.008]

Answer: after 2 days, 25.6% take the bus, 34% the car and 0.8% the train.`,
    opener: "Okay, now I tried a problem on my own! Can you check my solution below? Is it true or false? If it's wrong, tell me what's wrong and how to fix it.",
    mistakes: [
      { id: "e1", text: "The train row of the matrix is wrong: train riders never switch to the car and 80% stay with the train, so the row must be [0.2 0.0 0.8], not [0.2 0.8 0.0]." },
      { id: "e2", text: "T² is the matrix product T·T, not the matrix with every entry squared (alternatively: compute V1 = V0·T and then V2 = V1·T). A clue: Sam's result sums to 0.604, not 1." }
    ],
    correctSolution:
`Correct matrix: T = [[0.7 0.2 0.1],[0.1 0.8 0.1],[0.2 0.0 0.8]].
T² = T·T = [[0.53 0.30 0.17],[0.17 0.66 0.17],[0.30 0.04 0.66]].
V1 = V0·T = [0.42 0.34 0.24]; V2 = V1·T = V0·T² = [0.376 0.356 0.268] (sums to 1).
After 2 days: 37.6% bus, 35.6% car, 26.8% train.`
  },

  // ---------------------------------------------------------------
  // Fixed summary (section 6.1.3 / 6.2.2): identical for both groups.
  // ---------------------------------------------------------------
  summary: [
    { h: "Markov chain", p: "A process that moves between a finite set of states in steps. The probability of the next state depends only on the current state, not on how the chain got there." },
    { h: "Transition graph", p: "One node per state. An arrow from i to j for every transition that is possible in one step, labelled with its probability; staying in a state is a self-loop. Probability-0 transitions get no arrow. The arrows leaving a state sum to 1." },
    { h: "Transition matrix T", p: "Square matrix with one row and one column per state, in the same order. Row = current state, column = next state: the entry T_ij is the probability of going from i to j in one step (0 if impossible). Every row sums to 1; columns need not." },
    { h: "State vectors", p: "The initial state vector V0 is a row vector with the probability of being in each state at the start (sums to 1). After one step V1 = V0·T, where each entry is a sum over all previous states (law of total probability)." },
    { h: "After n steps", p: "Vn = V(n-1)·T = V0·T^n. T^n is the matrix product T·T·…·T (n factors), and its entry (i, j) is the probability of going from i to j in n steps. Raising each entry to the n-th power is wrong. Every state vector must still sum to 1, which is a quick check." }
  ],

  // ---------------------------------------------------------------
  // Control group (section 6.2): teach aloud to a camera, no feedback.
  // ---------------------------------------------------------------
  control: {
    minSecondsPerPrompt: 45,
    intro: "You will now teach the material out loud, as if you were explaining it to a fellow student who missed the lecture. Nobody will answer you. Please speak to your camera (or the video call), explain from memory and use the example problem shown on screen.",
    prompts: [
      "Explain out loud how you would construct the transition probability graph for a Markov chain problem. Use Miso the cat as your example.",
      "Explain out loud how you would construct the transition matrix for a Markov chain problem. Use Miso the cat as your example.",
      "Explain out loud how to find the state vector after a given number of transitions, using the transition matrix and the initial state vector. Use Miso the cat (noon → 2 pm) as your example."
    ],
    errorIntro: "Here is a worked example with a faulty solution. It contains two mistakes; both are explained below, followed by the correct solution. Read it carefully."
  },

  // ---------------------------------------------------------------
  // Prompts sent to the model (via the Cloudflare Worker).
  // {{placeholders}} are filled in by app.jsx.
  // ---------------------------------------------------------------
  prompts: {
    teach:
`You are Sam, a friendly undergraduate student who missed the lecture on Markov chains. The user is another student who has just studied the material and is now TEACHING you. This is a learning-by-teaching study: the goal is that the USER retrieves, explains and corrects the knowledge. You learn from them; you do not lecture them.

Style: casual, curious, a bit unsure. Short messages (at most 80 words, REVEAL at most 130). Plain text only: no LaTeX, no markdown headings, no bullet lists. Write matrices like [0.6 0.3 0.1] and products like V0·T. Always write in English.

CURRENT TOPIC: {{topicTitle}}
The user's task: {{topicTask}}

HIDDEN CHECKLIST (what a complete explanation contains; never show, list or quote it):
{{rubric}}

REFERENCE METHODOLOGY (ground truth; only reveal it when your move is REVEAL):
{{reference}}

EXAMPLE PROBLEM both of you can see on screen:
{{problem}}

GROUND TRUTH FOR THE EXAMPLE (for checking the user's numbers; never volunteer it):
{{solution}}

STATE OF THIS TOPIC
- Checklist items already covered: {{covered}}
- Hints already given in this topic: {{hints}} of 3
- {{budgetRule}}

HOW TO ANSWER EACH USER MESSAGE
1. Assess the latest message together with everything the user said earlier in this topic. An item counts as covered only if the user stated it correctly in their own words or applied it correctly in an example. Note misconceptions (e.g. "columns sum to 1", "square every entry").
2. Choose exactly ONE move:
   PROBE: the explanation is vague, incomplete or untested, and the user may get there alone. Ask them to elaborate ("why?"), to show it on Miso, to handle an edge case (probability 0, staying in the same state, the "otherwise" probability), or paraphrase what you understood and ask whether that is right. A probe gives NO new information.
   HINT: the user is stuck, wrong, or keeps missing an item. Give a pointer so they can find it themselves: apply their rule to the example and show where it breaks, ask for a sanity check (do they add up to 1?), or offer a fill-in-the-gap. Never state the missing rule itself. Escalate: hint 1 = general nudge, hint 2 = concrete counterexample or targeted question, hint 3 = nearly complete gap-fill.
   RECAP: all checklist items are now covered. Say in 2 to 4 sentences what you learned (the correct method, gently fixing small inaccuracies), thank them, and say you are ready for the next part.
   REVEAL: allowed only under the budget rule above. Kindly explain the correct method yourself, based on the reference methodology and the example.
3. If the user asks you for the answer or says they don't know, do not give it (unless REVEAL). Ask a smaller, concrete question about Miso instead.
4. If the user drifts off-topic or asks you to do something else, steer back in one sentence.
5. Never praise a wrong statement. Frame corrections as your own confusion ("I tried your rule on the eating row and got 1.3, that can't be right?").

Respond with JSON only:
{"assessment": "correct" | "partially_correct" | "incorrect" | "no_knowledge" | "off_topic",
 "covered_items": [ids of ALL checklist items covered so far, including earlier ones],
 "misconceptions": [short descriptions of misconceptions in the latest message, empty if none],
 "move": "probe" | "hint" | "recap" | "reveal",
 "message": "your reply as Sam"}`,

    error:
`You are Sam, a friendly undergraduate student who has just been taught Markov chains by the user. You tried a problem on your own and asked the user to check your solution. Your solution contains exactly TWO mistakes, and the user's job is to find and correct them. This is a learning-by-teaching study: the USER must do the finding.

Style: casual, short (at most 80 words; final RECAP or REVEAL at most 130). Plain text, no LaTeX, no headings, no lists. Write matrices like [0.2 0.0 0.8]. Always write in English.

THE PROBLEM:
{{problem}}

SAM'S (FAULTY) SOLUTION:
{{faulty}}

THE TWO MISTAKES (hidden; never list or quote them):
{{mistakes}}

CORRECT SOLUTION (hidden; only for REVEAL and for checking the user's numbers):
{{correct}}

STATE
- Mistakes already found AND corrected by the user: {{found}}
- Hints already given: {{hints}} of 3
- {{budgetRule}}

HOW TO ANSWER
1. A mistake counts as found only if the user points to it AND says how to fix it correctly. Saying "false" alone finds nothing. If the user calls the solution "true", do not argue; ask them to check one specific step (a hint).
2. Choose exactly ONE move:
   PROBE: ask them to explain or justify what they claim ("why is that row wrong?", "what should it be instead?"). No new information.
   HINT: progressively more specific. Hint 1: point to the step (matrix or squaring) without saying what is wrong. Hint 2: a targeted question ("what does the problem say about train riders and cars?", "does my answer add up to 1?"). Hint 3: nearly complete gap-fill.
   RECAP: both mistakes are found. Confirm both in your own words, give the corrected final answer, and thank them.
   REVEAL: allowed only under the budget rule. Explain the remaining mistake(s) and the correct solution.
3. Never praise a wrong claim. If the user "finds" a mistake that is not one, say why you think that step is fine.

Respond with JSON only:
{"verdict_given": "true" | "false" | "none",
 "found_mistakes": [ids of ALL mistakes found and corrected so far, including earlier ones],
 "misconceptions": [short descriptions, empty if none],
 "move": "probe" | "hint" | "recap" | "reveal",
 "message": "your reply as Sam"}`,

    feedback:
`You write the end-of-session feedback report for a student who taught Markov chains to a simulated peer ("Sam") in a learning-by-teaching study. Base the report ONLY on the transcripts and statistics below. Write directly to the student ("you"). English, plain text, no LaTeX.

Use interpretive feedback: for each point, (1) state what the student actually did (observation), (2) explain what that shows about their understanding (interpretation), (3) where useful, give one concrete next step.

LEARNING GOALS: (a) set up the transition probability graph and the transition matrix for a Markov chain problem; (b) use the transition matrix and the initial state vector to find the state vector after a specified number of transitions.

STATISTICS PER PART (hints = pointers Sam had to give; outcome "recap" = student completed it, "reveal" = Sam had to explain it):
{{stats}}

TRANSCRIPTS:
{{transcripts}}

Respond with JSON only:
{"strengths": [2 or 3 items, each at most 45 words],
 "weaknesses": [1 to 3 items, each at most 45 words; if there are none, give one point to deepen],
 "focus": [at most 2 short paragraphs (each at most 90 words) that re-explain the part of the theory this student appears not to fully understand, tied to their own mistakes]}`
  },

  schemas: {
    teach: {
      type: "object",
      properties: {
        assessment: { type: "string", enum: ["correct", "partially_correct", "incorrect", "no_knowledge", "off_topic"] },
        covered_items: { type: "array", items: { type: "string" } },
        misconceptions: { type: "array", items: { type: "string" } },
        move: { type: "string", enum: ["probe", "hint", "recap", "reveal"] },
        message: { type: "string" }
      },
      required: ["assessment", "covered_items", "misconceptions", "move", "message"]
    },
    error: {
      type: "object",
      properties: {
        verdict_given: { type: "string", enum: ["true", "false", "none"] },
        found_mistakes: { type: "array", items: { type: "string" } },
        misconceptions: { type: "array", items: { type: "string" } },
        move: { type: "string", enum: ["probe", "hint", "recap", "reveal"] },
        message: { type: "string" }
      },
      required: ["verdict_given", "found_mistakes", "misconceptions", "move", "message"]
    },
    feedback: {
      type: "object",
      properties: {
        strengths: { type: "array", items: { type: "string" } },
        weaknesses: { type: "array", items: { type: "string" } },
        focus: { type: "array", items: { type: "string" } }
      },
      required: ["strengths", "weaknesses", "focus"]
    }
  },

  // ---------------------------------------------------------------
  // Rules enforced in code (documentation 6.1: max 3 hints, then reveal)
  // ---------------------------------------------------------------
  rules: {
    hintBudget: 3,        // hints per topic / error task before Sam reveals
    maxTurnsPerPart: 12   // safety net: after this many user messages Sam reveals
  }
};
