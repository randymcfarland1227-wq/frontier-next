'use client';

/** Words that send a line to a site: "List hats @resale", "Role: email recruiter", "… #venture". */
const SITE_WORDS: Array<[RegExp, string]> = [
  [/^(resale|sell|sellhub|sell-hub)$/i, "resale"],
  [/^(role|rolehub|role-hub|job|jobs)$/i, "role"],
  [/^(finance|finances|radall|money)$/i, "radall"],
  [/^(repair|repairlog|repair-log)$/i, "repair"],
  [/^(move|moveos|move-os)$/i, "move"],
  [/^(venture|income|venturelab|venture-lab)$/i, "income"],
  [/^(candle|peculiar)$/i, "candle"],
  [/^self$/i, "self"],
];
const siteOfWord = (w: string) => SITE_WORDS.find(([re]) => re.test(w.replace(/\s+/g, "")))?.[1];

/** One line → title + site it's tagged for (undefined = use the default).  */
export function parseBulkLine(raw: string): { title: string; home?: string } {
  let line = raw.replace(/^\s*(?:[-*•]|\d+[.)]|\[ ?\])\s*/, "").trim();
  let home: string | undefined;
  const tag = line.match(/\s[@#]([a-z-]+)\s*$/i);
  if (tag && siteOfWord(tag[1])) {
    home = siteOfWord(tag[1]);
    line = line.slice(0, tag.index).trim();
  } else {
    const pre = line.match(/^([a-z -]{3,14}):\s+(.+)$/i);
    if (pre && siteOfWord(pre[1])) {
      home = siteOfWord(pre[1]);
      line = pre[2].trim();
    }
  }
  return { title: line, home };
}

