import { expect,test } from "vitest";
import { aliyahStarts,previewSelection } from "../../src/lib/readings/aliyah-starts";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
const verses=expandReadingRanges(["Genesis 1:30-2:3"],"torah",TANAKH_VERSE_COUNTS);
test("nullable boundaries distinguish legacy and one aliyah, and require unique ordered subsequent canonical starts",()=>{
  expect(aliyahStarts("torah",null,verses)).toBeNull();expect(aliyahStarts("torah",[],verses)).toEqual([]);
  expect(aliyahStarts("torah",["Genesis 1:31","Genesis 2:2"],verses)).toEqual(["Genesis 1:31","Genesis 2:2"]);
  for(const value of [undefined,"Genesis 2:1",[verses[0]],["Genesis 2:1","Genesis 1:31"],["Genesis 2:1","Genesis 2:1"],["Genesis 2:4"],[null],["Genesis 02:1"]])expect(()=>aliyahStarts("torah",value,verses)).toThrow();
  expect(aliyahStarts("haftarah",null,["Isaiah 1:1"])).toBeNull();for(const value of [[],["Isaiah 1:2"]])expect(()=>aliyahStarts("haftarah",value,["Isaiah 1:1","Isaiah 1:2"])).toThrow();
});
test("explicit preview selection crosses chapters/pages but never fills a missing verse or reverses endpoints",()=>{
  expect(previewSelection(["Genesis 1:1-6:8"],"torah","Genesis 1:30","Genesis 3:2")).toBe("Genesis 1:30-3:2");
  expect(previewSelection(["Isaiah 1:1-3"],"haftarah","Isaiah 1:2","Isaiah 1:2")).toBe("Isaiah 1:2");
  expect(()=>previewSelection(["Genesis 1:1-2","Genesis 1:4-5"],"torah","Genesis 1:1","Genesis 1:5")).toThrow();
  expect(previewSelection(["Genesis 1:1-2","Genesis 1:4-5"],"torah","Genesis 1:4","Genesis 1:5")).toBe("Genesis 1:4-5");
  expect(()=>previewSelection(["Genesis 1:1-3"],"torah","Genesis 1:3","Genesis 1:1")).toThrow();
});
