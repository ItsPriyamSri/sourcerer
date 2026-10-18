/**
 * The labelled identification set.
 *
 * Ground truth is what *I* wrote in the `text` field: a brand and an item type.
 * That makes the scoring mechanical and auditable — no model grades itself, and
 * every failure below can be checked by reading the row.
 *
 * These are the items a weekend flipper actually picks up: mid-tier brands, one or
 * two grails, and a few deliberately ambiguous entries where a reasonable person
 * would also hedge. The ambiguous ones are there to produce failures worth reporting.
 */

export interface EvalItem {
  id: string;
  /** What a person types at the rack, from a glance at the label. */
  text: string;
  /** Ground truth. `brand` may be null when the item genuinely has no brand. */
  brand: string | null;
  /** Strings, any of which counts as identifying the type correctly. */
  type: string[];
  /** Why this row is in the set. */
  note?: string;
}

export const ITEM_TYPES = ["clothing", "houseware", "camera", "audio", "instrument", "tool", "toy", "book", "textile"] as const;

export const EVAL_ITEMS: EvalItem[] = [
  { id: "01", text: "Levi's 501 Big E selvedge denim jacket, size 42, small hole at cuff", brand: "Levi's", type: ["jacket", "denim jacket"] },
  { id: "02", text: "Pyrex 444 Cinderella mixing bowl, green, nesting set of 3", brand: "Pyrex", type: ["bowl", "mixing bowl"] },
  { id: "03", text: "Nikon FM2 35mm film camera body, black, with 50mm lens", brand: "Nikon", type: ["camera"] },
  { id: "04", text: "Pendleton wool board shirt, size L, teal plaid", brand: "Pendleton", type: ["shirt"] },
  { id: "05", text: "Ludwig Acrolite snare drum, 14 inch, aluminium shell, with case", brand: "Ludwig", type: ["drum", "snare"] },
  { id: "06", text: "Griswold cast iron skillet #8, small block logo", brand: "Griswold", type: ["skillet", "pan", "cookware"] },
  { id: "07", text: "Polaroid SX-70 folding camera, leather, untested", brand: "Polaroid", type: ["camera"] },
  { id: "08", text: "Stetson Open Road straw hat, size 7 1/4, tan", brand: "Stetson", type: ["hat"] },
  { id: "09", text: "Sony Walkman WM-EX674 cassette player, works, no headphones", brand: "Sony", type: ["walkman", "cassette player", "cassette"] },
  { id: "10", text: "Teak serving tray, Denmark, mid century, no maker mark", brand: null, type: ["tray"], note: "no brand visible — the honest answer is 'unbranded'" },
  { id: "11", text: "Fender Princeton Reverb 1965 blackface amp chassis only", brand: "Fender", type: ["amplifier", "amp"] },
  { id: "12", text: "Woolrich 60/40 mountain parka, navy, size M", brand: "Woolrich", type: ["parka", "coat", "jacket"] },
  { id: "13", text: "KitchenAid K45 stand mixer, white, with paddle and dough hook", brand: "KitchenAid", type: ["mixer"] },
  { id: "14", text: "Stanley No. 4 smoothing plane, sweetheart iron", brand: "Stanley", type: ["plane"] },
  { id: "15", text: "Patagonia Synchilla fleece pullover, retro X, size M", brand: "Patagonia", type: ["fleece", "pullover", "jacket"] },
  { id: "16", text: "Weber kettle grill, 22 inch, one touch, rusted grate", brand: "Weber", type: ["grill"] },
  { id: "17", text: "Fiestaware dinner plates, set of 6, turquoise", brand: "Fiesta", type: ["plate", "dinnerware", "dish"] },
  { id: "18", text: "Technics SL-1200 turntable, no dust cover, needs stylus", brand: "Technics", type: ["turntable", "record player"] },
  { id: "19", text: "CorningWare blue cornflower casserole dish with lid, 2 quart", brand: "CorningWare", type: ["casserole", "dish", "baking dish"] },
  { id: "20", text: "Dr. Martens 1460 boots, black, size 9 UK, worn soles", brand: "Dr. Martens", type: ["boots", "boot"] },
  { id: "21", text: "Eames style lounge chair, rosewood, no labels anywhere", brand: null, type: ["chair", "lounge chair"], note: "the classic thrift trap: looks like Eames, unmarked" },
  { id: "22", text: "Wedgwood Jasperware trinket box, pale blue, small chip on lid", brand: "Wedgwood", type: ["box", "trinket box", "jar"] },
  { id: "23", text: "Coleman 228E lantern, green, two mantle, glass intact", brand: "Coleman", type: ["lantern"] },
  { id: "24", text: "Vintage quilt, hand stitched, some fading, no tags", brand: null, type: ["quilt"], note: "no brand, and the model must not invent one" },
  { id: "25", text: "Braun ET66 calculator, black, with case", brand: "Braun", type: ["calculator"] },
  { id: "26", text: "Filson wool cruiser jacket, tin cloth, size 40", brand: "Filson", type: ["jacket", "coat"] },
  { id: "27", text: "Singer Featherweight 221 sewing machine, black, with case", brand: "Singer", type: ["sewing machine"] },
  { id: "28", text: "Hello Kitty ceramic mug, Sanrio 2001, small crack in handle", brand: "Sanrio", type: ["mug", "cup"] },
  { id: "29", text: "Orvis Battenkill fly reel, made in England, with pouch", brand: "Orvis", type: ["reel", "fly reel"] },
  { id: "30", text: "Unknown brass desk lamp, weighted base, adjustable arm, no markings", brand: null, type: ["lamp"], note: "deliberately unidentifiable — tests whether the model invents a brand" },
];
