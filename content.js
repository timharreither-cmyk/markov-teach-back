// =====================================================================
// content.js: everything the participant reads and everything Sam is told.
// Edit texts here; the app logic lives in app.jsx.
// Notation follows the learning material (LibreTexts 10.1): T = transition
// matrix, V0 = initial state vector, Vn = V0·T^n, rows = current state.
// All numbers below were checked with numpy.
// =====================================================================

window.STUDY = {
  version: "3.0",

  // ---------------------------------------------------------------
  // Time limits in minutes (identical for both groups). When a timer
  // runs out, the app moves on to the next phase automatically.
  // ---------------------------------------------------------------
  timing: {
    material: 10,   // reading the material
    example: 15,    // steps 1-3 with the Miso example
    error: 10       // checking the wrong statements
  },

  // ---------------------------------------------------------------
  // Shared example (steps 1-3, both groups). Graph and matrix are NOT
  // shown: building them is what the student explains.
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
Every row sums to 1. Columns need not (column S sums to 1.3).
Initial state vector at noon: V0 = [0.5  0  0.5].
After 1 hour: V1 = V0·T = [0.45  0.25  0.30].
After 2 hours: V2 = V1·T = V0·T² = [0.46  0.195  0.345].
T² = T·T = [[0.51 0.20 0.29],[0.42 0.24 0.34],[0.41 0.19 0.40]].`
  },

  // ---------------------------------------------------------------
  // Steps 1-3 (both groups).
  // rubric = hidden checklist Sam uses to judge the explanation (AI group).
  // reference = correct method; Sam gives it at the end of each step.
  // textbookHints = fixed hints for the control group (Hint button),
  //                 so both groups can get up to 3 hints per step.
  // ---------------------------------------------------------------
  topics: [
    {
      id: "T1",
      title: "Transition graph",
      task: "Explain how the transition graph of a Markov chain is built and what its parts mean: the states, the arrows and the probabilities. Use Miso the cat as your example.",
      opener: "Hi! I missed the lecture on Markov chains. My notes say you can show a Markov chain as a \"transition graph\", but I don't understand what such a graph actually represents. What are its parts, and how do I get them from Miso's story?",
      rubric: [
        { id: "g1", text: "The nodes are the possible states of the system (here S, E, P)." },
        { id: "g2", text: "An arrow from state i to state j stands for the one-step transition probability: the probability that the chain is in j at the next step, given it is in i now. It depends only on the current state (Markov property). The values come from the problem text." },
        { id: "g3", text: "Staying in the same state is also a transition: it is a self-loop with its probability (e.g. S→S 0.6, P→P 0.5)." },
        { id: "g4", text: "An impossible transition (probability 0) gets no arrow (e.g. no E→E)." },
        { id: "g5", text: "The probabilities on the arrows leaving a state add up to 1, because at the next step the chain must be in some state; an 'otherwise' value is therefore 1 minus the others." }
      ],
      reference:
`Here is how I understand it now: the nodes are the states (S, E, P). An arrow from i to j means "if Miso is in i now, Miso is in j one hour later with this probability". It only depends on the current state. Staying put is also a step, so it gets a loop (S→S 0.6). Impossible transitions (probability 0, like eating twice in a row) get no arrow. The arrows leaving each state add up to 1, because Miso has to be somewhere next hour. That also fills in "otherwise": S→P = 1 − 0.6 − 0.3 = 0.1. For Miso that gives 8 arrows.`,
      textbookHints: [
        "Start with the states: every possible situation of the system becomes one node of the graph.",
        "An arrow from state i to state j means: if the chain is in i now, it is in j at the next step with the probability written on the arrow. Staying in the same state is also a step.",
        "Check each state: the probabilities on all arrows leaving it must add up to 1. A missing \"otherwise\" value is 1 minus the given ones; a probability of 0 means there is no arrow."
      ]
    },
    {
      id: "T2",
      title: "Transition matrix",
      task: "Explain how to construct the transition matrix of a Markov chain and what its entries mean. Use Miso the cat as your example.",
      opener: "Thanks, the graph makes sense now! My notes also say I need a \"transition matrix\" T. How do I turn Miso's situation into a matrix, and what do the numbers in it mean?",
      rubric: [
        { id: "m1", text: "T is a square n×n matrix with one row and one column per state, using the same order of states for rows and columns." },
        { id: "m2", text: "The entry in row i, column j is the probability of moving from state i (current) to state j (next) in one step, i.e. the label of the arrow i→j." },
        { id: "m3", text: "Every row sums to 1 and all entries are between 0 and 1 (columns do not have to sum to 1)." },
        { id: "m4", text: "Impossible transitions are entered as 0; the matrix contains exactly the same information as the graph." }
      ],
      reference:
`So: pick an order for the states, say S, E, P, and use it for both rows and columns. Row = where Miso is now, column = where Miso goes next. The entry in row i, column j is the one-step probability from i to j, which is the label of the arrow i→j, or 0 if there is no arrow. For Miso: row S = [0.6 0.3 0.1], row E = [0.4 0 0.6], row P = [0.3 0.2 0.5]. Each row is a complete "where can Miso go from here" list, so each row sums to 1; the columns don't have to.`,
      textbookHints: [
        "Fix one order of the states and use it for both the rows and the columns.",
        "Row = current state, column = next state. The entry in row i, column j is the probability of going from i to j in one step, which is the label of the arrow i→j (0 if there is no arrow).",
        "Each row describes all possible next states of one current state, so every row must sum to 1. The columns do not have to."
      ]
    },
    {
      id: "T3",
      title: "State vector after n steps",
      task: "Explain how to find the state vector (the distribution) after a given number of transitions, using the transition matrix and the initial state vector, and why this works. Use Miso (noon → 2 pm) as your example.",
      opener: "Last part! The exercise asks: how likely is each state for Miso at 2 pm, if at noon Miso is sleeping with 50% and playing with 50%? I have the matrix T now, but how do I get from noon to 2 pm, and why does that work?",
      rubric: [
        { id: "s1", text: "The initial state vector V0 is a row vector with the probability of being in each state at the start (same order as T); its entries sum to 1. Here V0 = [0.5 0 0.5]." },
        { id: "s2", text: "One transition: V1 = V0·T (row vector times matrix). Entry j of V1 is the sum over i of V0_i · T_ij, i.e. the law of total probability over where the chain was before." },
        { id: "s3", text: "n transitions: multiply n times, Vn = V(n-1)·T = V0·T^n, where T^n is a matrix product (T·T·…), NOT the entries raised to the power n." },
        { id: "s4", text: "Sanity check: every state vector still sums to 1. For Miso at 2 pm (2 steps): V2 = [0.46 0.195 0.345]." }
      ],
      reference:
`Got it, I think: write the start as a row vector in the same state order as T, V0 = [0.5 0 0.5]. One hour later is V1 = V0·T. For each next state j you add up "probability of being in i" times "probability of going i→j" over all i (law of total probability), which gives V1 = [0.45 0.25 0.30]. For two hours, do it again: V2 = V1·T = [0.46 0.195 0.345]. In general Vn = V0·T^n, where T^n means multiplying the matrix by itself n times; squaring each entry is NOT the same. Each vector must still sum to 1.`,
      textbookHints: [
        "Write the starting situation as a row vector V0 with one probability per state, in the same order as the matrix.",
        "One step: V1 = V0·T. Each entry of V1 adds up \"probability of being in state i\" × \"probability of going from i to j\" over all states i (law of total probability).",
        "Several steps: repeat the multiplication, Vn = V(n−1)·T = V0·T^n. T^n is a matrix product, not the entries raised to a power. Check that each vector sums to 1."
      ]
    }
  ],

  // ---------------------------------------------------------------
  // Step 4: wrong statements to check (both groups), one per category.
  // AI group: Sam says them in the chat. Control group: shown as cards,
  // the solution appears after the student submits an answer.
  // ---------------------------------------------------------------
  statementsIntro: "Okay, I think I get it now! Let me check whether I understood everything. I'll tell you what I concluded, one thing at a time, and you tell me if I'm right. If I'm wrong, please correct me!",
  statements: [
    {
      id: "E1", category: "Graph",
      text: "Ah okay, so from Playing there are only two arrows: P→S with 0.3 and P→E with 0.2. Nothing else is mentioned, so there is no arrow from P back to P.",
      mistake: "The self-loop P→P with probability 0.5 is missing (\"otherwise keeps playing\"). The arrows leaving P must add up to 1: 0.3 + 0.2 + 0.5.",
      correction: "Three arrows leave P: P→S 0.3, P→E 0.2 and the self-loop P→P 0.5. Together they sum to 1.",
      textbookHints: [
        "Read the sentence about playing again, all the way to the end.",
        "Add up the probabilities on the arrows leaving P. What must this sum be?",
        "\"Otherwise keeps playing\" is a transition from P to P, with probability 1 − 0.3 − 0.2."
      ]
    },
    {
      id: "E2", category: "Matrix",
      text: "So in the transition matrix every column has to add up to 1. The S column is 0.6, 0.4 and 0.3, which is 1.3, so I must have made a mistake somewhere in the matrix.",
      mistake: "The rows sum to 1, not the columns: a row lists everything that can happen from one current state. Column S summing to 1.3 is completely fine. The rows are 0.6+0.3+0.1, 0.4+0+0.6 and 0.3+0.2+0.5, all equal to 1.",
      correction: "Each ROW must sum to 1 (row = current state). The columns don't have to; the matrix is correct.",
      textbookHints: [
        "Which states do the rows stand for, and which do the columns stand for?",
        "A row lists all the places Miso can go from one current state. What must those probabilities add up to?",
        "Check the rows: 0.6 + 0.3 + 0.1, 0.4 + 0 + 0.6 and 0.3 + 0.2 + 0.5."
      ]
    },
    {
      id: "E3", category: "Matrix entries",
      text: "The entry in row E, column S is the probability that Miso goes eating after sleeping, so it's 0.3.",
      mistake: "Row = current state, column = next state. Row E, column S is the probability of going FROM eating TO sleeping, which is 0.4. The 0.3 (sleeping → eating) is in row S, column E.",
      correction: "T_ES = P(sleeping next | eating now) = 0.4. The value 0.3 belongs to row S, column E.",
      textbookHints: [
        "In row E, column S: which state is \"now\" and which is \"next\"?",
        "Row E means Miso is eating now. What happens after eating?",
        "After eating, Miso falls asleep with probability 0.4. Where in the matrix does the 0.3 (sleeping → eating) go?"
      ]
    },
    {
      id: "E4", category: "State vector",
      text: "If Miso is sleeping at noon, then the probability that Miso is sleeping at 2 pm is 0.6 × 0.6 = 0.36, because Miso has to stay asleep for two hours.",
      mistake: "Miso does not have to sleep the whole time: Miso can also be asleep at 2 pm via eating or playing at 1 pm. All paths must be added: S→S→S 0.6·0.6 = 0.36, S→E→S 0.3·0.4 = 0.12, S→P→S 0.1·0.3 = 0.03, in total 0.51. This is entry (S,S) of T² = T·T, or the S entry of V2 = V0·T² with V0 = [1 0 0].",
      correction: "P(S at 2 pm | S at noon) = 0.36 + 0.12 + 0.03 = 0.51, i.e. the (S,S) entry of T·T.",
      textbookHints: [
        "Does Miso have to stay asleep the whole time to be asleep at 2 pm?",
        "List all ways from S at noon to S at 2 pm, through each possible state at 1 pm, and add their probabilities.",
        "S→S→S, S→E→S and S→P→S: compute 0.6·0.6 + 0.3·0.4 + 0.1·0.3."
      ]
    }
  ],

  // ---------------------------------------------------------------
  // Fixed summary (identical for both groups).
  // ---------------------------------------------------------------
  summary: [
    { h: "Markov chain", p: "A process that moves between a finite set of states in steps. The probability of the next state depends only on the current state, not on how the chain got there." },
    { h: "Transition graph", p: "One node per state. An arrow from i to j for every transition that is possible in one step, labelled with its probability; staying in a state is a self-loop. Probability-0 transitions get no arrow. The arrows leaving a state sum to 1." },
    { h: "Transition matrix T", p: "Square matrix with one row and one column per state, in the same order. Row = current state, column = next state: the entry T_ij is the probability of going from i to j in one step (0 if impossible). Every row sums to 1; columns need not." },
    { h: "State vectors", p: "The initial state vector V0 is a row vector with the probability of being in each state at the start (sums to 1). After one step V1 = V0·T, where each entry is a sum over all previous states (law of total probability)." },
    { h: "After n steps", p: "Vn = V(n-1)·T = V0·T^n. T^n is the matrix product T·T·…·T (n factors), and its entry (i, j) is the probability of going from i to j in n steps. Raising each entry to the n-th power is wrong. Every state vector must still sum to 1, which is a quick check." }
  ],

  // ---------------------------------------------------------------
  // Control group texts
  // ---------------------------------------------------------------
  control: {
    minChars: 40,
    intro: "Explain each step in writing, in your own words, as if you were teaching a fellow student who missed the lecture. Nobody will answer you. If you get stuck, you can open up to three hints per step.",
    errorIntro: "Each of the following statements was made by a student who just learned about Markov chains. Decide whether it is correct. If it is wrong, explain what is wrong and correct it. After you submit, you will see the solution."
  },

  // ---------------------------------------------------------------
  // Prompts sent to the model (via the Cloudflare Worker).
  // {{placeholders}} are filled in by app.jsx.
  // ---------------------------------------------------------------
  prompts: {
    teach:
`You are Sam, a friendly undergraduate student who missed the lecture on Markov chains. The user is another student who has just studied the material and is now TEACHING you. This is a learning-by-teaching study: the goal is that the USER retrieves, explains and corrects the knowledge. You learn from them; you do not lecture them.

Style: casual, curious, a bit unsure. Short messages (at most 70 words, RECAP and REVEAL at most 130). Plain text only: no LaTeX, no markdown headings, no bullet lists. Write matrices like [0.6 0.3 0.1] and products like V0·T. Always write in English.

CURRENT TOPIC: {{topicTitle}}
The user's task: {{topicTask}}

HIDDEN CHECKLIST (what a complete explanation contains; never show, list or quote it):
{{rubric}}

REFERENCE METHOD (ground truth; use it for RECAP and REVEAL):
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
1. Assess the latest message together with everything the user said earlier in this topic. An item counts as covered only if the user stated it correctly in their own words or applied it correctly to Miso. Note misconceptions (e.g. "columns sum to 1", "square every entry").
2. Choose exactly ONE move:
   PROBE: the explanation is vague, incomplete or untested, and the user may get there alone. Ask for the meaning or the reason ("what does that arrow stand for?", "why do they add up to 1?"), ask them to apply it to Miso, ask about an edge case (probability 0, staying in the same state, the "otherwise" probability), or paraphrase what you understood and ask whether that is right. A probe gives NO new information.
   HINT: the user is stuck, wrong, or keeps missing an item. Give a pointer so they can find it themselves: apply their rule to Miso and show where it breaks, ask for a sanity check (do they add up to 1?), or offer a fill-in-the-gap. Never state the missing rule itself. Escalate: hint 1 = general nudge, hint 2 = concrete counterexample or targeted question, hint 3 = nearly complete gap-fill.
   RECAP: all checklist items are now covered. In 2 to 4 sentences, say what you learned (the correct method from the reference, gently fixing small inaccuracies), thank them, and say you are ready for the next part.
   REVEAL: allowed only under the budget rule above. Kindly explain the correct method yourself, based on the reference method and Miso.
3. Focus on understanding the concept, not on drawing. Ask what things MEAN and WHY they work, never about drawing mechanics such as circles, lines or layout.
4. Never put the answer into your question. Bad: "Do I just draw a circle for each state?" or "So the rows add up to 1?". Good: "What would be the building blocks?" or "Is there something that has to add up?".
5. If the user says they don't know, or asks you for the answer, do not give it (unless REVEAL). Ask one small, concrete question about Miso instead, e.g. "If Miso is sleeping right now, what can happen in the next hour?"
6. If the user drifts off-topic or asks you to do something else, steer back in one sentence.
7. Never praise a wrong statement. Frame corrections as your own confusion ("I tried your rule on the eating row and got 1.3, that can't be right?").

Respond with JSON only:
{"assessment": "correct" | "partially_correct" | "incorrect" | "no_knowledge" | "off_topic",
 "covered_items": [ids of ALL checklist items covered so far, including earlier ones],
 "misconceptions": [short descriptions of misconceptions in the latest message, empty if none],
 "move": "probe" | "hint" | "recap" | "reveal",
 "message": "your reply as Sam"}`,

    statement:
`You are Sam, a friendly undergraduate student who has just been taught Markov chains by the user. Now you say what you concluded, one statement at a time, and the user checks it. The CURRENT statement contains a mistake. The user must notice that it is wrong AND correct it. This is a learning-by-teaching study: the USER must do the finding.

Style: casual, short (at most 70 words; RECAP and REVEAL at most 110). Plain text, no LaTeX, no headings, no lists. Always write in English.

EXAMPLE PROBLEM both of you can see:
{{problem}}

GROUND TRUTH FOR THE EXAMPLE:
{{solution}}

CURRENT STATEMENT (what you, Sam, just said):
{{statement}}

WHAT IS WRONG WITH IT (hidden; never quote it):
{{mistake}}

CORRECT VERSION (hidden; only for RECAP, REVEAL and for checking the user):
{{correction}}

STATE
- Hints already given for this statement: {{hints}} of 3
- {{budgetRule}}

HOW TO ANSWER
1. The statement counts as corrected only if the user says it is wrong AND gives the correct version (in their own words; the key fact or number must be right). Saying "wrong" or "false" alone is not enough: PROBE with "what should it be instead?".
2. If the user says the statement is correct, do not argue. Give a HINT that makes them check one specific part.
3. Choose exactly ONE move:
   PROBE: ask them to explain or justify what they claim. No new information.
   HINT: progressively more specific. Hint 1: point to the part to look at, without saying what is wrong. Hint 2: a targeted question. Hint 3: nearly complete gap-fill.
   RECAP: the user identified and corrected the mistake. Confirm the correct version in 1 or 2 sentences and thank them. Do NOT bring up any new statement; the app does that.
   REVEAL: allowed only under the budget rule. Explain what is wrong and give the correct version.
4. Never praise a wrong claim. If the user "corrects" something that was actually fine, say why you think that part is fine. Stay on this statement; if the user drifts off-topic, steer back in one sentence.

Respond with JSON only:
{"verdict_given": "true" | "false" | "none",
 "corrected": true | false,
 "misconceptions": [short descriptions, empty if none],
 "move": "probe" | "hint" | "recap" | "reveal",
 "message": "your reply as Sam"}`,

    feedback:
`You write the end-of-session feedback report for a student who taught Markov chains to a simulated peer ("Sam") in a learning-by-teaching study. Base the report ONLY on the transcripts and statistics below. Write directly to the student ("you"). English, plain text, no LaTeX.

Use interpretive feedback: for each point, (1) state what the student actually did (observation), (2) explain what that shows about their understanding (interpretation), (3) where useful, give one concrete next step.

LEARNING GOALS: (a) set up the transition probability graph and the transition matrix for a Markov chain problem; (b) use the transition matrix and the initial state vector to find the state vector after a specified number of transitions.

STATISTICS PER PART (hints = pointers Sam had to give; outcome "recap" = student completed it, "reveal" = Sam had to explain it, "timeout" = time ran out):
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
    statement: {
      type: "object",
      properties: {
        verdict_given: { type: "string", enum: ["true", "false", "none"] },
        corrected: { type: "boolean" },
        misconceptions: { type: "array", items: { type: "string" } },
        move: { type: "string", enum: ["probe", "hint", "recap", "reveal"] },
        message: { type: "string" }
      },
      required: ["verdict_given", "corrected", "misconceptions", "move", "message"]
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
  // Rules enforced in code (3 hints, then Sam gives the method/answer)
  // ---------------------------------------------------------------
  rules: {
    hintBudget: 3,        // hints per topic / per statement before Sam reveals
    maxTurnsPerPart: 10   // safety net: after this many user messages Sam reveals
  }
};
