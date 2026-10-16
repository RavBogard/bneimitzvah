export const studyEditions = {
  mam: { key: "mam", versionTitle: "Miqra according to the Masorah", language: "he", creator: "Dovi and Hebrew Wikisource contributors, via Sefaria",
    sourceUrl: "https://he.wikisource.org/wiki/משתמש:Dovi/מקרא_על_פי_המסורה", license: "CC-BY-SA-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    changes: "Markup and notes removed; Unicode and spacing normalized; written/read alternatives and Masoretic breaks represented separately. Adapted text retains CC BY-SA 4.0." },
  jps2023: { key: "jps2023", versionTitle: "THE JPS TANAKH: Gender-Sensitive Edition", language: "en", creator: "The Jewish Publication Society, 2023, via Sefaria",
    sourceUrl: "https://jps.org/books/the-jps-tanakh-gender-sensitive-edition/", license: "CC-BY-NC-4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
    changes: "Markup and footnotes removed; Unicode and spacing normalized. Noncommercial use; no alternate edition substituted." },
} as const;
export type StudyEdition = typeof studyEditions[keyof typeof studyEditions];
export type StudyChapter = { ref: string; sefariaUrl: string; fetchedAt: number; hash: string; editions: StudyEdition[] };

export function StudyCredits({ chapters }: { chapters: StudyChapter[] }) {
  const editions = [...new Map(chapters.flatMap(chapter => chapter.editions).map(edition => [edition.key, edition])).values()];
  return <details className="study-credits"><summary>Text sources, licenses and changes</summary>
    <p>Text is provided through Sefaria. These editions retain their own terms; the application’s code license does not replace them.</p>
    {editions.map(edition => <section key={edition.key}><h4>{edition.versionTitle}</h4><p>{edition.creator}</p><p><a href={edition.sourceUrl} target="_blank" rel="noopener noreferrer">Edition source</a> · <a href={edition.licenseUrl} target="_blank" rel="noopener noreferrer">{edition.license}</a></p><p>{edition.changes}</p></section>)}
    <ul>{chapters.map(chapter => <li key={chapter.ref}><a href={chapter.sefariaUrl} target="_blank" rel="noopener noreferrer">{chapter.ref} on Sefaria</a> · Fetched <time dateTime={new Date(chapter.fetchedAt).toISOString()}>{new Date(chapter.fetchedAt).toLocaleString()}</time></li>)}</ul>
  </details>;
}
