/**
 * Every learner-facing string of the service course that is not lesson data, one constant per id of
 * `A7-STRINGS.md` (Daniel approved all of them, "Keep all", 2026-10-24). Apostrophes are the typographic one, as
 * the app ships them. Titles, summaries and goals live in `course.json` beside the lessons they name; the
 * approved teachings live in the congregation file. Nothing here quotes the siddur: page numbers only.
 * The tone rule (no exclamation point, emoji, streak, badge, score or pep talk) is tested over this whole object.
 */
export const COPY = Object.freeze({
  home: Object.freeze({
    title: "Learn the service", // home.title
    intro: "Each prayer in the Shabbat morning service: what it is, how to read it, and where it is in the siddur.", // home.intro
    nextLabel: "Next", // home.next.label
    start: "Start", // home.next.start
    minutes: "about {n} minutes", // home.next.minutes
    allHeading: "The whole service", // home.all.heading
    done: "Done. Review when you like.", // home.done
    saved: "Progress is saved on this device. Sign in to keep it.", // home.saved
    about: "About", // home.about
    lein: "Learn to lein", // home.lein
    dotDone: ", done", // home.state.dot.done
    dotNext: ", next", // home.state.dot.next
    eveningLater: "Saturday evening and Havdalah come next.", // home.evening.later
    nav: "Course", // aria-label of the link row (Learn to lein uses the same word)
    mineHeading: "Your parts", // home.mine.heading (2.0 SC4)
    mineLine: "The prayers you lead, in service order.", // home.mine.line
    serviceStart: "Your whole service in the siddur, from page {page}", // home.serviceStart, the approved 1.8 string
    fluencyRow: "New to Hebrew letters? Start with Reading Hebrew.", // home.fluency.row
    reviewRow: "Review: {n} words, about {m} minutes", // home.review.row
    quickTenRow: "Quick ten: ten words from your prayers, about 2 minutes", // qt.homeRow
  }),
  frame: Object.freeze({
    close: "Back to the course", // frame.close
    skip: "Skip to the lesson", // frame.skip
    rail: "Step {n} of {total}", // frame.rail
    next: "Next", // frame.next
  }),
  step: Object.freeze({
    about: "About this prayer", // step.about
    where: "Where it is in the service", // step.where
    read: "Read it", // step.read
    words: "Key words", // step.words
    check: "Check", // step.check
  }),
  about: Object.freeze({
    moment: "This part of the service has no prayer text to read. It is here so you know what happens and when.", // about.moment
  }),
  where: Object.freeze({
    line: "{prayer} comes after {before} and before {after}.", // where.line
    first: "{prayer} opens the service.", // where.first
    last: "{prayer} closes the service.", // where.last
    section: "Part of {section}.", // where.section
    page: "In your siddur it is on page {page}.", // where.page
  }),
  read: Object.freeze({
    inSiddur: "This prayer’s text is in the siddur.", // read.inSiddur
    instruction: "Read each line aloud at your own pace. Tap a word to see what it means.", // read.instruction
    instructionNoCard: "Read each line aloud at your own pace.", // read.instruction.nocard
    translitShow: "Show transliteration", // read.translit.show
    translitHide: "Hide transliteration", // read.translit.hide
    englishShow: "Show English", // read.english.show
    englishHide: "Hide English", // read.english.hide
    siddurNote: "Your siddur may print this prayer a little differently. Read it there too.", // read.siddurNote
    credit: "Text: {volume}, {licence}.", // read.credit
    newToHebrew: "New to Hebrew letters? Start with Reading Hebrew.", // read.newToHebrew
  }),
  words: Object.freeze({
    instruction: "A few words to know in this prayer. Tap one for more.", // words.instruction
    more: "More about this word", // words.more
  }),
  check: Object.freeze({
    instruction: "A few questions on what you just read. Answer before you look.", // check.instruction
    whichSays: "Which word says {translit}?", // check.whichSays
    whichMeans: "Which word means {gloss}?", // check.whichMeans
    whatMeans: "What does this word mean?", // check.whatMeans
    right: "Yes. {word} is {translit}.", // check.right
    rightMeaning: "Yes. {word} means {gloss}.", // check.rightMeaning
    miss: "That one is {translit}.", // check.miss
    missMeaning: "That one means {gloss}.", // check.missMeaning
    again: "This one comes back in a moment.", // check.again
  }),
  fluency: Object.freeze({
    letterPrompt: "Which letter is this?", // fl.letter.prompt
    letterLookalike: "These two look alike. Which one is {name}?", // fl.letter.lookalike
    finalPrompt: "This letter comes only at the end of a word. Which letter is it?", // fl.final.prompt
    vowelPrompt: "Which sound does this make?", // fl.vowel.prompt
    vowelTell: "{vowel} sounds like {sound}.", // fl.vowel.tell
    dotPrompt: "With the dot or without it?", // fl.dot.prompt
    shinPrompt: "Is this shin or sin?", // fl.dot.shin
    dotTell: "The dot makes {a}. Without it, {b}.", // fl.dot.tell
    wordInstruction: "Read the word one syllable at a time. Then show the transliteration to check yourself.", // fl.word.instruction
    wordShow: "Show transliteration", // fl.word.show
    wordPrompt: "Which word says {translit}?", // fl.word.prompt
    lineInstruction: "Read the whole line aloud. Then show the transliteration, one word at a time.", // fl.line.instruction
    lineReveal: "Show the next word", // fl.line.reveal
    lineReadIt: "I read it", // fl.line.readIt
    lineNotYet: "Not yet", // fl.line.notYet
    // The two letter names the shin-or-sin prompt and its answers use; both are in A7's list of letter names for {name}.
    shin: "Shin",
    sin: "Sin",
  }),
  quickTen: Object.freeze({
    title: "Quick ten", // qt.title
    prompt: "Which says {translit}?", // qt.prompt
    stop: "Stop here", // qt.stop
    endClean: "Done.", // qt.endClean
    endMissed: "Done. The ones you missed come back in review.", // qt.endMissed
    empty: "Quick ten opens after three prayers you have read.", // qt.empty
    loading: "Loading the words…", // qt.loading
  }),
  review: Object.freeze({
    title: "Review", // rv.title
    loading: "Loading the review…", // rv.loading
    empty: "Nothing to review today.", // rv.empty
    done: "Done.", // the Quick ten's clean ending, reused: A7 has no line for the end of a review
  }),
  done: Object.freeze({
    word: "Done", // step.done
    siddur: "Open in the siddur, page {page}", // done.siddur, the approved 1.8 string
    nextName: "Next: {lesson}", // done.nextName
    nextMine: "Next of your parts: {lesson}", // done.nextMine (2.0 SC4)
    startNext: "Start next lesson", // done.startNext
    back: "Back to the course", // done.back
  }),
  state: Object.freeze({
    homeLoading: "Loading the course…", // st.home.loading
    lessonLoading: "Loading the lesson…", // st.lesson.loading
    textError: "The prayer text did not load. Try again.", // st.text.error
    retry: "Try again", // st.retry
    notFound: "This lesson isn’t in the course.", // st.notfound
    tenantOff: "The service course isn’t available here yet.", // st.tenant.off
    pathLoading: "Checking your parts…", // st.path.loading (2.0 SC4)
    pathError: "Your parts could not be loaded. The whole service is below.", // st.path.error
    pathNoPlan: "Your tutor hasn’t chosen your parts yet. These are the parts most students lead.", // st.path.noplan
    pathCleared: "No service parts are assigned to you right now.", // st.path.cleared
    pathReview: "Your parts may change. Your tutor will review them with you.", // st.path.review
    pathWithdrawn: "Your parts are being updated. Ask your tutor which ones you lead.", // st.path.withdrawn
    slotUnknown: "Page numbers are from the morning service until your service time is set.", // st.slot.unknown
    // 2.0 SC6, offline (A7, approved "Keep all").
    textOffline: "This prayer’s text isn’t saved on this device. Connect to read it.", // st.text.offline
    offlineAbout: "You can still read about this prayer.", // st.offline.teachingOk
    pathOffline: "Your parts as of {date}. They update when you are online.", // st.path.offline
  }),
  // The per-part finished mark (2.0 SC5, A7 "Tutor view (staff only)", Batch 3 Q12): staff strings, and the student's own line.
  tutor: Object.freeze({
    heading: "Learn the service", // tu.heading
    line: "Parts {firstName} has finished. Nothing else is shared.", // tu.line
    colPart: "Part", // tu.col.part
    colStatus: "Status", // tu.col.status
    finished: "Finished", // tu.finished
    finishedOn: "Finished {date}", // tu.finished.on
    notYet: "Not yet", // tu.notyet
    empty: "No service parts are assigned yet.", // tu.empty
    error: "The list couldn’t be loaded.", // tu.error
    loading: "Loading the parts…", // tu.loading
    studentLine: "Your tutor can see which of your parts you’ve finished.", // tu.student.line
  }),
  aboutPage: Object.freeze({
    title: "About this course", // ab.title
    p1: "Each lesson teaches one prayer: what it is, where it sits in the service, how to read it, and a few words to know. The teaching on each prayer is by Rabbi Daniel Bogard.", // ab.p1
    p2: "The Hebrew here comes from Shirei Tfilah, a public siddur. Your own siddur may differ in places, so each lesson links to its page there.", // ab.p2
    p3: "Nothing here records you. Progress stays on this device unless you sign in.", // ab.p3
  }),
});

/** Fills `{name}` placeholders. A missing value leaves nothing behind rather than the braces. */
export const fill = (template: string, values: Readonly<Record<string, string | number>>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** Typographic apostrophes and quotes for text kept verbatim in the data files (the approved teachings). */
export function typographic(text: string): string {
  return text.replace(/(?<=[A-Za-z0-9])'/g, "’").replace(/(^|[\s(—])"/g, "$1“").replace(/"/g, "”");
}

/** A string with `*emphasis*` marks as segments, so a teaching's transliterated words can be set in italics without raw HTML. */
export function emphasised(text: string): readonly { em: boolean; text: string }[] {
  return text.split(/(\*[^*]+\*)/).filter(Boolean).map(part => part.startsWith("*") && part.endsWith("*") && part.length > 2 ? { em: true, text: part.slice(1, -1) } : { em: false, text: part });
}
