# Capability Inventory — Universal LPC Spritesheet Character Generator

Repo root: `C:\Users\kanis\.zcode\workspace\default\lpc-generator-src`
443 MB on disk incl. `.git` (323 MB without; `spritesheets/` = 312 MB / 88,114 PNGs).

**Architecture note.** This clone is NOT the legacy `index.html + scripts.js + universal.json` app. It is a **Vite + Mithril SPA in TypeScript** (`sources/`, 71 TS files). There is no top-level `universal.json`, no `palettes.js`, no `licenses/` dir. The "universal" sheet layout now lives in `tools/layout/universal.json` (13×21 grid) and `tools/layout/universal-expanded.json` (13×54 grid) — lpctools layout files. Sources of truth:

- `sheet_definitions/` — 768 JSON = **657 item definitions + 111 `meta_*` category definitions** (3.2 MB)
- `palette_definitions/` — 22 JSON defining recolor materials (64 KB)
- `spritesheets/` — **88,114 PNGs** in 20 top-level folders
- `scripts/generateSources/` — Node pipeline compiling the above into **five generated metadata modules** in `dist/` (`index-`, `item-`, `palette-`, `credits-`, `layers-metadata.js`; `dist/` gitignored, built by the Vite plugin `vite/vite-plugin-item-metadata.ts` or `npm run validate-site-sources`)
- `CREDITS.csv` (3.98 MB, 13,915 asset rows; header `filename,notes,authors,licenses,urls`) — **generated**, not hand-edited

The shareable/exported character document is the **URL hash**: `#sex=male&body=Body_Color_light&head=Human_Male_light&expression=Neutral_light` (CONTRIBUTING.md "URL hash"; `sources/state/hash.ts`). `itemId` = definition JSON **filename** without extension (`sheet_definitions/feet/shoes/feet_shoes_sara.json` → `feet_shoes_sara`; `scripts/generateSources/items.ts:110`).

---

## 1. FULL PARAMETER SURFACE

### 1.1 Body type (hash key `sex`, kept for legacy compatibility; state field `bodyType`)
`BODY_TYPES` (`sources/state/constants.ts:9-16`): **`male`, `female`, `teen`, `child`, `muscular`, `pregnant`**.
Base art in `spritesheets/body/bodies/{male,female,teen,child,muscular,pregnant,skeleton,zombie}/`.
Per-item coverage (items whose `layer_1` has the body key, of 657): **male 611 · female 617 · teen 564 · muscular 534 · pregnant 548 · child 101**.
- No `elderly` body type: elderly = head items (`heads_human_male_elderly`, `heads_human_female_elderly` → `head/heads/human/male_elderly/`, mapped onto all 5 adult body types).
- `teen`/`child` often reuse adult asset folders (e.g. `hair/bangs/` only has `adult/` on disk; teen maps to it). Child has its own body base.
- Category gating: `meta_*.json` `required` restricts body types per category (e.g. `torso/dresses` → `["female","teen"]`; `torso/vest` → `["male"]`; `weapons` → the 5 adults; `head/heads/undead` → all 5 adults). Item-level gating via `required` = body keys present in `layer_1`.

### 1.2 Selection groups (`type_name` = hash key = radio group)
**104 distinct `type_name` values; 657 selectable items.** Selectable-item counts per group (from the item-level `type_name` field; a few groups below are recolor sub-groups only, e.g. `eyes` = head's `color_2` eye recolor):

| Group | # | Folder(s) | Representative exact identifiers (itemId — "Name" / variants) |
|---|---|---|---|
| `hair` | 91 | `hair/{afro,bald,bob,braids,curly,extensions,long,pigtails,short,spiky,xlong,beards,mustaches}` | `hair_afro` "Afro"; `hair_buzzcut` "Buzzcut"; `hair_cornrows`; `hair_dreadlocks_long`; `hair_bangs` "Bangs" (recolors); `hairext_high_bun` (group `updo`) "High Bun"; `hairext_topknot_long` ("ponytail") "Long Topknot"; left/right extension pairs `hairext_braidl`/`hairext_braidr` (groups `hairextl`/`hairextr`, 7 each) |
| `hat` | 50 | `headwear/hats/{athwart,caps,foreaft,formal,holiday,magic,tricorne}`, `headwear/coverings/hoods` | `hat_bicorne_athwart_admiral` "Bicorne Athwart Admiral" [24 cloth colors]; `hat_cap_bonnie` "Bonnie"; `hat_cap_cavalier`; `hat_cap_leather` "Leather Cap" [25 incl. base]; `hat_hood_cloth` "Hood"; `hat_hood_hijab` "Hijab"; `hat_holiday_elf`; `hat_magic_wizard` etc. |
| `shield_pattern` | 48 | `weapons/shields/heater/{pattern,revised_pattern}` | `shield_heater_pattern_barry` "barry"; `_bend`, `_bendy`, `_bordure`, `_chevron`, `_cross`, `_fess`, `_lozengy`, … heraldic terms |
| `head` | 45 | `head/heads/{beast,fantasy,farm,human,reptile,undead}` | `heads_human_male` "Human Male"; `heads_human_male_small/gaunt/plump`; `heads_human_child`; `heads_wolf_male`, `heads_minotaur`, `heads_goblin`, `heads_orc_child`, `heads_lizard_male`, `heads_alien`, `heads_zombie`-era undead set |
| `weapon` | 40 | `weapons/{sword,polearm,blunt,ranged,magic}`, `tools/` | `weapon_sword_katana` "Katana" [katana]; `weapon_sword_longsword`, `weapon_sword_dagger`, `weapon_sword_arming`, `weapon_sword_glowsword`, `weapon_sword_rapier`, `weapon_sword_saber`, `weapon_sword_scimitar`, `weapon_sword_longsword_alt`; `weapon_polearm_spear/dragonspear/halberd/longspear/scythe/spear/trident/cane`; `weapon_blunt_club/flail/mace/waraxe`; `weapon_ranged_bow_normal/recurve/great`, `weapon_ranged_crossbow`, `weapon_ranged_slingshot`, `weapon_ranged_boomerang`; `weapon_magic_wand/simple/loop/gnarled/diamond/s`; tool items `tool_axe` "Axe", `tool_hammer`, `tool_hoe`, `tool_pickaxe`, `tool_rod` "Fishing Rod", `tool_shovel`, `tool_watering_can`, `tool_whip` (all `type_name` "weapon") |
| `clothes` | 35 | `torso/shirts/{longsleeve,shortsleeve,sleeveless,sleeves}` | `torso_clothes_longsleeve` "Longsleeve"; `torso_clothes_longsleeve2_buttoned` "Longsleeve 2 Buttoned"; `torso_clothes_longsleeve2_cardigan` "Cardigan"; `torso_clothes_corset`; `torso_clothes_robe`; `torso_clothes_tunic`; `torso_clothes_blouse`; `torso_clothes_child_shirt` |
| `legs` | 21 | `legs/{leggings,pants,shorts,skirts}` | `legs_hose` "Hose"; `legs_leggings`; `legs_pants` "Pants"; `legs_pants2` "Long Pants"; `legs_childpants` [9 colors]; `legs_pregnantpants` [19]; `legs_cuffed`, `legs_formal`, `legs_pantaloons`; skirts incl. `legs_skirt_overskirt` (group `apron`) |
| `eyes` (recolor sub-group; special eye items `eyes_cyclops`, `eyes_cyclops2`) | 21 | `head/eyes/` | head items carry `color_2: {type_name:"eyes"}` eye-color recolor |
| `charm` | 16 | `headwear/neck/charms` | `neck_amulet_cross` "Cross amulet" [48: `brass_blue`…]; `neck_charm_box/oval/ring/star` [8 metals]; `neck_gem_emerald/marquise/natural/pear` [6 gem colors] |
| `expression` | 15 | `head/faces` | `face_neutral` "Neutral" (default selection); `face_angry` "Angry"; `face_happy`; `face_sad`; `face_look_l` "Looking Left"; `face_eyeroll` "Rolling Eyes"; `face_closed` "Closed Eyes"; `face_blush`; `face_shock`; + `expression_crying` `face_tears` "Tears" [blue] |
| `facial_eyes` | 14 | `headwear/accessories/{eyepatch,glasses}` | `facial_eyepatch_left/right/ambi` [24-25 colors]; `facial_glasses` "Glasses" [32]; `facial_glasses_halfmoon/nerd/round/secretary`; `facial_glasses_round` [34 incl. base,sunglasses] |
| `hat_trim` | 13 | hat subfolders | `hat_bicorne_athwart_admiral_trim` [33: base+metals+colors]; `hat_cap_bonnie_trim` "Bonnie Center Trim"; `hat_holiday_elf` "Elf Trim"; `hat_magic_wizard_belt` "Wizard Hat Belt" |
| `shoes` | 12 | `feet/{boots,shoes}` | `feet_boots_basic` "Basic Boots"; `feet_boots_fold` "Folded Rim Boots"; `feet_boots_revised` "Revised Boots"; `feet_boots_rim` "Rimmed Boots"; `feet_shoes_basic` "Basic Shoes"; `feet_shoes_ghillies` "Ghillies"; `feet_shoes_revised` "Revised Shoes"; `feet_shoes_sara` "Sara Shoes" |
| `wings` | 11 | `body/wings/{dragonfly,monarch,pixie}` | `wings_bat` "Bat Wings" [44 fur colors]; `wings_feathered` "Feathered Wings"; `wings_lizard`, `wings_lizard_alt`, `wings_lunar` "Lunar Wings"; `wings_dragonfly` (+`wings_dragonfly_transparent`); `wings_monarch` + companions `wings_dots`/`wings_edge`; `wings_pixie` (+transparent) |
| `ears` | 10 | `head/ears` | `head_ears_big` "Big ears"; `head_ears_elven` "Elven ears"; `head_ears_down` "Downward Elven Ears"; `head_ears_dragon` "Dragon Ears"; `head_ears_hang` "Hanging Elven Ears"; `head_ears_long` "Long ears"; `head_ears_medium` "Medium Elven Ears"; side-furry trio `head_ears_avyon` "Feather Ears", `head_ears_lykon` "Side Wolf Ears", `head_ears_zabos` "Side Cat Ears" |
| `visor` | 9 | `headwear/helmets/visors` | `hat_visor_grated` "Grated visor"; `hat_visor_grated_narrow`; `hat_visor_horned` "Horned visor"; `hat_visor_pigface` (+`_raised`); `hat_visor_round` (+`_raised`); `hat_visor_slit` (+`_narrow`) |
| `shield` | 9 | `weapons/shields` | `shield_kite` "Kite" [10, e.g. `kite blue blue`, `kite gray green`]; `shield_round` "Round Shield" [brown,black,gold,green,silver,yellow]; `shield_spartan` "Spartan Shield" [spartan]; `shield_scutum` "Scutum shield" [scutum]; `shield_crusader` "Crusader shield" [crusader]; `shield_plus` "Plus shield" [plus]; `shield_two_engrailed` "Two engrailed shield"; `shield_heater_wood` "Heater Shield Base"; `shield_heater_revised_wood` "Revised Heater Shield Base" |
| `accessory` | 9 | `headwear/helmets/accessories` | `hat_accessory_crest` "Crest"; `hat_accessory_crest_centurion`; `hat_accessory_horns_downward` "Downward Horns"; `hat_accessory_horns_short/upward`; `hat_accessory_plumage` (+centurion/legion); `hat_accessory_wings` "Helmet wings" |
| `neck` | 8 | `headwear/neck` | `neck_bowtie` "Bowtie"; `neck_bowtie2` "Bowtie 2"; `neck_capeclip` "Cape Clip"; `neck_capetie` "Cape Tie"; `neck_cravat` "Cravat"; `neck_jabot` "Jabot"; `neck_necktie` "Necktie"; `neck_scarf` "Scarf" |
| `mustache` | 8 | `hair/mustaches` | `beards_bigstache` "Big Mustache"; `beards_chevron`; `beards_french`; `beards_handlebar`; `beards_horseshoe`; `beards_lampshade`; `beards_mustache`; `beards_walrus` (all "… Mustache") |
| `belt` | 8 | `torso/waist` | `belt_belly` "Belly belt" [7: brown,charcoal,leather,slate,tan,walnut,…]; `belt_double` "Double Belt"; `belt_formal` "Formal Belt" [brown]; `belt_leather` "Leather Belt"; `belt_leather2` "Leather Belt Alt" [leather]; `belt_loose` "Loose Belt"; `belt_mage` "Mage Belt" [black,bronze,brown,gold,iron,silver]; `belt_robe` "Robe Belt" [teal,white] |
| `hairextl` / `hairextr` | 7 / 7 | `hair/extensions/bangs` | `hairext_braidl` "Left Braid"; `hairext_long_straightl` "Left Long Straight"; `hairext_long_wavyl`; `hairext_xlong_bangl`; `hairext_xlong_braidl`; `hairext_xlong_curlyl`; `hairext_xlong_wavyl` + right-side mirrors |
| `jacket` | 6 | `torso/jacket` | `torso_jacket_collared` "Collared coat" [25]; `torso_jacket_frock` "Frock coat" [24]; `torso_jacket_iverness` "Iverness cloak" [black]; `torso_jacket_santa` "Santa coat" [24]; `torso_jacket_tabard` "Tabard" [19]; `torso_jacket_trench` "Trench coat" [dark gray,gray] |
| `sleeves` | 5 | `torso/shirts/{longsleeve,sleeves}` | `torso_clothes_longsleeves` "Original Longsleeves Overlay"; `torso_clothes_shortsleeves` "Original Shortsleeves Overlay"; `torso_clothes_longsleeves2`, `torso_clothes_shortsleeves2`, `torso_clothes_longsleeves_cuffed` "Cuffed Longsleeves Overlay" |
| `tail` | 5 | `body/{tails,lizard}` | `tail_cat` "Cat Tail" [33 fur]; `tail_wolf` "Wolf Tail"; `tail_wolf_fluffy` "Fluffy Wolf Tail"; `tail_lizard_alt` "Lizard Tail (Alt Colors)"; `tail_lizard` "Lizard tail" |
| `nose` | 5 | `head/nose` | `head_nose_big` "Big nose"; `head_nose_button` "Button nose"; `head_nose_elderly` "Elderly nose"; `head_nose_large` "Large nose"; `head_nose_straight` "Straight nose" |
| `necklace` | 5 | `headwear/neck` | `neck_necklace` "Necklace" [9 metals]; `neck_necklace_beaded_large` "Large Beaded Necklace"; `neck_necklace_beaded_small`; `neck_necklace_chain` "Chain Necklace" [8]; `neck_necklace_simple` "Simple Necklace" [8] |
| `earrings` | 5 | `headwear/accessories/earrings` | `facial_earrings_emerald` "Emerald earrings" [6 gem colors]; `facial_earrings_moon` "Moon earrings" [8 metals]; `facial_earrings_pear`; `facial_earrings_princess`; `facial_earrings_stud` [8] |
| `beard` | 5 | `hair/beards` | `beards_5oclock_shadow` "5 O'clock Shadow"; `beards_beard` "Basic Beard"; `beards_medium` "Medium Beard"; `beards_trimmed` "Trimmed Beard"; `beards_winter` "Winter Beard" |
| `vest` | 4 | `torso/{vest,dresses}` | `torso_clothes_vest` "Vest" [26]; `torso_clothes_vest_open` "Vest open"; `dress_bodice` "Bodice" [24]; `torso_clothes_corset` "Corset" [19] |
| `shoulders` | 4 | `arms/shoulders` | `shoulders_epaulets` "Epaulets"; `shoulders_legion` "Legion"; `shoulders_mantal` "Mantal"; `shoulders_pauldrons` "Pauldrons" |
| `shield_trim` | 4 | shields subfolders | `shield_two_engrailed_trim` [two_engrailed_trim]; `shield_heater_revised_trim` "Revised Heater Shield Trim"; `shield_heater_trim` "Heater Shield Trim"; `shield_scutum_trim` "Scutum shield trim" [scutum_trim] |
| `sash` | 4 | `torso/waist` | `belt_sash` "Sash" [24]; `belt_sash_narrow` "Narrow sash" [24]; `belt_waistband` "Waistband" [24]; `belt_obi` "Obi" [24] |
| `dress` | 4 | `torso/dresses` | `dress_sash` "Sash dress" [24]; `dress_slit` "Slit dress" [24]; `dress_kimono` "Kimono" [24]; `dress_kimono_split` "Split Kimono" [24] |
| `bandana` | 4 | `headwear/coverings/bandana`, `headwear/helmets/helmets` | `hat_bandana` "Bandana"; `hat_bandana2` "Bordered Bandana"; `hat_bandana_pirate` "Pirate Bandana"; `hat_helmet_mail` "Mail" |
| `backpack` | 4 | `torso/backpack` | `backpack` "Backpack" [20]; `backpack_basket` "Basket" [round,square]; `backpack_jetpack` "Jetpack" [bronze,gold,steel]; `backpack_squarepack` "Square pack" [20] |
| `apron` | 4 | `torso/aprons`, `legs/skirts` | `torso_aprons_apron` "Apron" [24]; `torso_aprons_apron_full` "Apron full"; `torso_aprons_apron_half` "Apron half"; `legs_skirt_overskirt` "Overskirt" |
| `socks` / `ponytail` / `jacket_trim` / `headcover` / `hat_overlay` / `body` / `armour` / `cargo` | 3 each | — | `feet_socks_ankle` "Ankle Socks"; `feet_socks_high`; `feet_socks_tabi` "Tabi Socks" · `hairext_topknot_long` "Long Topknot"; `hairext_topknot_relm` "Relm Topknot"; `hairext_topknot_short` "Short Topknot" · `torso_jacket_frock_buttons/lace/lapel` "Frock coat …" [7] · `hat_headband_kerchief` "Kerchief"; `hat_headband_thick` "Thick Headband"; `hat_headband_tied` "Tied Headband" · `hat_bicorne_athwart_basic_skull` "Bicorne Athwart Skull"; `hat_bicorne_athwart_captain_skull`; `hat_tricorne_captain_skull` "Tricorne Captain Skull" · `body` "Body Color"; `body_skeleton` "Skeleton"; `body_zombie` "Zombie" [zombie] · `torso_armour_leather` "Leather"; `torso_armour_legion` "Legion"; `torso_armour_plate` "Plate" · `backpack_contents_ore` "Ore" [8]; `backpack_contents_wood` "Wood" [3_logs,9_logs]; `backpack_jetpack_fins` "Jetpack fins" |
| ~50 single-item groups | 1 each | various | `fins` `head_fins_fin` "Fin"/`head_fins_fin_short` "Short fin" · `horns` `head_horns_backwards` "Backwards Horns"/`head_horns_curled` "Curled Horns" · `eyebrows` `eyebrows_thick` "Thick Eyebrows"/`eyebrows_thin` "Thin Eyebrows" · `wound_arm` "Arm", `wound_brain` "Brain" [red], `wound_eye_left` "Left Eye", `wound_eye_right` "Right Eye", `wound_mouth` "Mouth", `wound_ribs` "Ribs" · `wrinkles` `head_wrinkles` "Wrinkles" · `updo` `hairext_high_bun` "High Bun" · `quiver` `quiver` "Quiver" [quiver] (`sheet_definitions/torso/backpack/quiver.json`; assets in `spritesheets/quiver/`) · `cape` `cape_solid` "Solid"/`cape_tattered` "Tattered" · `cape_trim` · `overalls` `torso_aprons_overalls` "Overalls" [24]/`torso_aprons_suspenders` "Suspenders" [24] · `dress_sleeves` `dress_kimono_longsleeve`/`dress_kimono_oversize` (+`_trim` pairs) · `sash_tie` `belt_obi_knot_left` "Obi Knot Left"/`belt_obi_knot_right` "Obi Knot Right" · `shield_paint` `shield_heater_paint` "Heater Shield Paint"/`shield_heater_revised_paint` · `arms` `arms_armour` "Armour" · `gloves` `arms_gloves` "Gloves" · `ring` `arms_hands_ring_stud` "Stud Ring" · `bauldron` `bauldron` "Bauldron" · `bracers` `arms_bracers` "Bracers" · `wrists` `wrists_cuffs` "Cuffs"/`wrists_cuffs_lace` "Lace Cuffs" · feet `feet_armour` "Armour", `feet_hoofs` "Hoofs", `feet_sandals` "Sandals", `feet_slippers` "Slippers" (type `shoes`) · `shoes_toe` `feet_plate_toe` "Plated Toe"/`feet_plate_toe_thick` "Thick Plated Toe" · `furry_ears` `head_ears_cat` "Cat Ears"/`head_ears_wolf` "Wolf Ears" · `furry_ears_skin` ×2 skintone · `ears_inner` ×3 skintone · `bandages` `torso_bandages` "Bandages" [white] · `chainmail` `torso_chainmail` "Chainmail" · `buckles` `buckles` "Buckles" [bronze,gold,iron,silver] · `leather_armor_belt` · `weapon_magic_crystal` `weapon_magic_crystal` "Crystal" [6 gem colors] · `ammo` `weapon_ranged_bow_arrow` "Ammo" [arrow] · `hat_accessory` `hat_bicorne_athwart_admiral_cockade` "… Cockade"; `hat_cap_bonnie_feather` "Bonnie feather"; `hat_cap_cavalier_feather`; `hat_cap_leather_feather` · `hat_accessory_secondary` · `hat_buckle` `hat_magic_wizard_buckle` "Wizard Hat Buckle" [8 metals] · `hairtie` `hat_headband_hairtie` "Hair Tie" · `hairtie_rune` `hat_headband_hairtie_rune` "Hair Tie Rune" · `headcover_rune` `hat_headband_thick_rune` "Thick Headband Rune" · `bandana_overlay` `hat_bandana_pirate_skull` "Skull Bandana Overlay" · monocle `facial_monocle_left` "Left Monocle" [8 metals] (+`_frame` trim ×2, group `facial_left(_trim)`/`facial_right(_trim)`) · `earring_left` `facial_earring_left` "Simple Earring Left" [33]; `facial_earring_right` · `facial_mask` `facial_mask_plain` "Plain Mask" [34] · `backpack_straps` `backpack_straps` "Straps" [20] · `shadow` `body_shadow` "Shadow" · `wheelchair` `body_wheelchair` "Wheelchair" [black,blue,pink,tan,white] · `prosthesis_hand` `prosthesis_hook` "Hook Hand" · `prosthesis_leg` `prosthesis_peg_leg" "Peg leg" · `bones`/`reel`/`clip`/`stomach`/`handle`/`eyes`/`inner_ear`/`hat_secondary`/`sleeves`-trims appear both as item types and as `recolors[].type_name` sub-groups (a sub-recolor is a nested selection under an item, e.g. `head`'s `color_2` → eye color). |

Notes on how the parameters surface:
- Hash value format per group: `<Name>[_<variant>][|<recolor>]` with spaces in the item's `name` replaced by `_` (e.g. `Sara_Shoes`, `Body_Color`). Resolution is case-insensitive, prefix-scan based (`sources/state/resolve-hash-param.ts:286-360`), so `Longsword_longsword` = item "Longsword" + variant "longsword".
- Defaults (`selectDefaults`, `sources/state/state.ts:184`): `body`→recolor `light`, `head`→`heads_human_male` recolor `light`, `expression`→`face_neutral` recolor `light`; `selectedAnimation` = `"walk"`; `matchBodyColorEnabled` = true; license filters all on; animation filters all off (= show all).
- Multiple selections per `type_name` are NOT allowed (radio group); multiple *colors* under one item are allowed via `subId` (e.g. `head` carries two recolors: skin `color_1` + eye `color_2`).

## 2. COLOR OPTIONS

Recoloring is palette-swap based (WebGL or CPU, `sources/canvas/palette-recolor.ts`); **no free-form hex input exists**. Colors come from named palettes in `palette_definitions/`. Each item declares `recolors` (single `{material, palettes:[tokens]}` or multi `color_1..color_9` with `type_name`/`label`), and the build expands token lists into concrete variant strings (`scripts/generateSources/item-helper.ts:75-101`).

Materials and their named palettes (meta files give `label`, `default` version, `base` color):

| Material (`palette_definitions/<m>/`) | Label | Default version / base | Palette color keys |
|---|---|---|---|
| `body` | "Skintone" | ulpc / `light` | **ulpc (21):** light, amber, olive, taupe, bronze, brown, black, blue, bright_green, dark_green, fur_black, fur_brown, fur_copper, fur_gold, fur_grey, fur_tan, fur_white, green, lavender, pale_green, zombie, zombie_green. **lpcr (9):** ivory, porcelain, peach, tan, tawny, honey, bronze, brown, coffee. |
| `hair` | "Hair" | ulpc / `orange` | **ulpc (25):** orange, ash, platinum, white, gray, blonde, sandy, strawberry, gold, ginger, carrot, redhead, red, light_brown, chestnut, dark_brown, dark_gray, black, raven, rose, pink, purple, violet, navy, blue, green. **lpcr (20):** ash_brown, black, blonde, blue, brown, charcoal, chestnut, gray, green, orange, pink, platinum, purple, raven, red, ruby, silver, teal, violet, white. |
| `eye` | "Eyes" | ulpc / `blue` | **ulpc (8):** blue, green, purple, red, orange, yellow, brown, gray. **lpcr (7):** black, blue, brown, gray, green, hazel, purple. (3-color palettes, not interchangeable with other materials.) |
| `cloth` | "General" | ulpc / `white` | **ulpc (24):** brown, leather, walnut, yellow, tan, orange, rose, maroon, red, pink, lavender, purple, blue, navy, teal, bluegray, forest, green, white, sky, slate, gray, black, charcoal. |
| `metal` | "Metal" | ulpc / `steel` | **ulpc (8):** ceramic, brass, copper, bronze, iron, steel, silver, gold. **lpcr (7):** brass, copper, bronze, iron, steel, silver, gold. |
| `wood` | "Wood" | ulpc / `maple` | **ulpc (4):** maple, oak, walnut, mahogany. **lpcr (5):** brown, coffee, oak, tan, umber. |
| `all` | "Any" | lpcr / `white` | **lpcr (~75):** ivory … yellow (full mixed list, `palette_definitions/all/all_lpcr.json`; e.g. aegean, amethyst, azure, cerise, denim, emerald, garnet, heather, indigo, periwinkle, tumeric …). |

Recolor key syntax (`parseRecolorKey`, `sources/state/palettes.ts:355`): `material.version.color` | `version.color` | `color`, e.g. `metal.bronze`, `lpcr.ivory`, `light`. In URL/JSON the recolor is joined after the variant with `|`: `hat=Epaulets_?|metal.bronze` style (alias example `"Epaulets_bronze": "metal.bronze"`).

Custom colors: **per-item source palettes only.** An item's `recolors` may include `source: string[]` (exact hex list); then the UI offers a `material.custom` version (`CUSTOM_KEY="source"`, `CUSTOM_VERSION="custom"`, `sources/state/palettes.ts:285-286`) — you pick one of that item's own source colors, not an arbitrary hex. `palette_definitions/meta_custom.json`: "Custom palettes on a case-by-case basis." `match_body_color: true` items (body, heads, faces, many cloth items) automatically track the body recolor when `matchBodyColorEnabled` (state flag, default on; `applyMatchBodyColor` in `sources/state/state.ts:229`).

## 3. ANIMATIONS

Full universal sheet canvas: **832 × 3456 px = 13 columns × 54 rows of 64 px frames** (`SHEET_WIDTH`/`SHEET_HEIGHT`, `sources/canvas/renderer.ts:164-165`); directions in row order `up, left, down, right` (`DIRECTIONS`, `constants.ts:19`).

### 3.1 Standard animations (15, `ANIMATIONS` at `sources/state/constants.ts:60-91`)
| value (param id) | UI label | sheet folder name | rows (4-row blocks unless noted) | frames/row | frame cycle (from `ANIMATION_CONFIGS`) | notes |
|---|---|---|---|---|---|---|
| `spellcast` | Spellcast | spellcast | 0–3 | 4 | [0,1,2,3,4,5,6] (7 frames) | |
| `thrust` | Thrust | thrust | 4–7 | 4 | [0..7] (8 frames) | row also hosts `watering` |
| `walk` | Walk | walk | 8–11 | 4 | [1..8] (9 frames) | |
| `slash` | Slash | slash | 12–15 | 4 | [0..5] (6 frames) | |
| `shoot` | Shoot | shoot | 16–19 | 4 | [0..12] (13 frames — full row width) | |
| `hurt` | Hurt | hurt | row 20 only | 1 | [0..5] (6 frames, south) | |
| `climb` | Climb | climb | row 21 only | 1 | [0..5] (6 frames, north) | |
| `idle` | Idle | idle | 22–25 | 4 | [0,0,1] (2 frames) | |
| `jump` | Jump | jump | 26–29 | 4 | [0,1,2,3,4,1] (5 frames) | |
| `sit` | Sit | sit | 30–33 | 4 | 15-step 3-frame cycle | wheelchair uses frame 2 |
| `emote` | Emote | emote | 34–37 | 4 | 15-step 3-frame cycle | |
| `run` | Run | run | 38–41 | 4 | [0..7] (8 frames) | |
| `combat` | Combat Idle | **`combat_idle`** (`folderName`) | 42–45 | 4 | [0,0,1] (2 frames) | |
| `watering` | Watering | shares thrust row 4 | 4 | 4 | [0,1,4,4,4,4,5] | `noExport: true` (skipped in per-item zip) |
| `1h_slash` | 1-Handed Slash | **`backslash`** | row 46 | 4 | [0..6] | `noExport: true`; backslash row supports 1h_slash OR 1h_backslash |
| `1h_backslash` | 1-Handed Backslash | **`backslash`** | row 46 | 4 | [0..5,7..12] | 13 frames |
| `1h_halfslash` | 1-Handed Halfslash | **`halfslash`** | row 50 | 4 | [0..5] (6 frames) | |

`ANIMATION_DEFAULTS` (used when a sheet def omits `animations`): `["spellcast","thrust","walk","slash","shoot","hurt","watering"]`. `ANIMATION_OFFSETS` (`constants.ts:105-121`) = row-start y-offsets above.

Row layout cross-check: `tools/layout/universal-expanded.json` (lpctools layout, 13×54) places exactly: cast 7 f (rows 0–3), thrust 8 f (4–7), walk 9 f (8–11), slash 6 f (12–15), shoot 13 f (16–19), hurt 6 f south-only (20), climb 6 f north-only (21), idle 2 f (22–25), jump 5 f (26–29), sit 3 f (30–33), emote 3 f (34–37), run 8 f (38–41), combat_idle 2 f (42–45), backslash 13 f (46–49), halfslash 6 f (50–53). The classic **`tools/layout/universal.json` is 13×21** (rows 0–20: cast/thrust/walk/slash/shoot/hurt only) — "get the original universal sheets" per `tools/REBUILD.md`.

### 3.2 Custom animation definitions (`sources/custom-animations.ts`, 15 defs)
Appended below y=3456 on the canvas; items declare them in `animations` and their layers via `custom_animation`:
`wheelchair` (64 px, sit-frames×2), `tool_rod` (128 px, 13-frame thrust retiming), `tool_axe` / `tool_hammer` (128 px, 10-frame, `sourceSingleAnimation`), `tool_whip`, `whip_oversize` (192 px, 8-frame slash retime), `slash_128` (128 px), `backslash_128` (128 px, 13 frames), `halfslash_128` (128 px), `thrust_128` (128 px, 8 frames), `walk_128` (128 px, 9 frames, `skipFirstFrameInPreview`), `slash_oversize` / `thrust_oversize` / `slash_reverse_oversize` (192 px). Per-animation PNG width can therefore be 832 (64 px) up to 2496 px (13×192).

### 3.3 Per-item / per-body-type availability
Items list supported animations in `animations`; renderer row-mapping special cases (`sources/canvas/renderer.ts` ~430–455): `thrust` row renders for items with `thrust` OR `watering`; `combat_idle` row for `combat`; `backslash` row for `1h_slash` OR `1h_backslash`; `halfslash` row for `1h_halfslash`. Coverage across 657 items (explicit or default): spellcast 612, thrust 617, walk 646, slash 612, shoot 615, hurt 619, watering 578, climb 467, idle 536, jump 491, sit 492, emote 498, run 489, combat 470, 1h_slash 469, 1h_backslash 469, 1h_halfslash 469. On-disk animation-file counts confirm: `walk.png` 919, `thrust.png` 881, `slash.png`/`spellcast.png` 879, `shoot.png` 877, `idle.png` 841, `jump.png` 826, `hurt.png` 823, `sit.png` 776, `emote.png` 775, `run.png` 756, `backslash.png` 743, `combat_idle.png` 716, `halfslash.png` 714, `climb.png` 560.
Body types: adult bases (male/female/teen/muscular/pregnant) support the full set; **child** base exists for only 101 items (mostly core body/head/hair); weapons category excludes child (`meta_weapons.json` required list). UI filters: `enabledAnimations` (any checked → tree shows only items supporting ≥1 checked animation; custom anims count via their base, `sources/state/filters.ts:154-189`).

## 4. SAVED CHARACTER / EXPORT FORMATS

### 4.1 `character.json` (v2) — `exportStateAsJSON` (`sources/state/json.ts:130-158`)
```json
{
  "version": 2,
  "bodyType": "male",
  "selections": {
    "body":  { "itemId": "body", "subId": null, "variant": "", "recolor": "light", "name": "Body Color (light)" },
    "head":  { "itemId": "heads_human_male", "subId": null, "variant": "", "recolor": "light", "name": "Human Male (light)" },
    "hair":  { "itemId": "hair_natural", "subId": null, "variant": "violet", "recolor": "", "name": "Natural (violet)" }
  },
  "selectedAnimation": "walk",
  "showTransparencyGrid": true,
  "applyTransparencyMask": false,
  "matchBodyColorEnabled": true,
  "compactDisplay": false,
  "enabledLicenses": { "CC0": true, "CC-BY-SA": true, "CC-BY": true, "OGA-BY": true, "GPL": true },
  "enabledAnimations": { "spellcast": false, "thrust": false, "walk": false, "slash": false, "shoot": false,
                         "hurt": false, "climb": false, "idle": false, "jump": false, "sit": false, "emote": false,
                         "run": false, "watering": false, "combat": false, "1h_slash": false, "1h_backslash": false, "1h_halfslash": false },
  "url": "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/#sex=male&body=Body_Color_light&head=Human_Male_light&hair=Natural_violet",
  "layers": [ /* SerializedLayer[], below */ ],
  "credits": [ /* CreditWithFileName[] — fileName + notes/authors/licenses/urls, scoped to used files for bodyType */ ]
}
```
`selections` is keyed by **selection group** (`type_name`, e.g. `body`, `head`, `hair`, `weapon`, `expression`); one entry per group. `subId` indexes an item's `color_N` sub-recolors. **Real example:** `tests/fixtures/issue-382/issue-382-selections.json` (male; body+head light; hair Natural violet; Iverness cloak black; Long Pants orange; Revised Shoes bluegray; Longsword; `selectedAnimation: "slash_oversize"`).

**`layers[]` — `SerializedLayer` (`sources/state/json.ts:18-29`)** (one entry per deduped `(itemId, layerNum)`; `supportedAnimations` aggregated across draw calls):
```json
{
  "itemId": "body",
  "name": "Body Color (light)",
  "variant": "",
  "recolors": { "body": "light" },
  "zPos": 10, "layerNum": 1, "yPos": 0,
  "needsRecolor": false,
  "source": { "kind": "catalog", "spritePath": "body/bodies/male/spellcast.png" },
  "supportedAnimations": ["spellcast","thrust","walk","slash","shoot","hurt","watering","idle","jump","sit","emote","run","combat_idle","backslash","halfslash"]
}
```
`source.kind` is `"catalog"` (with `spritePath` relative to the spritesheet root, no `spritesheets/` prefix) or `"custom"` (user-uploaded overlay PNG; no path recorded). `yPos` = the animation row-start y-offset for that layer's animation. The **legacy v1** format is just `{ "version": 1, "url": "…#hash" }` (`importStateFromJSON`, `json.ts:174-232`); the issue-382 fixture shows the older layer shape with `fileName`/`isCustom` instead of `source` — import still accepts v1.

### 4.2 Other outputs the tool produces
| Output | Producer | Shape |
|---|---|---|
| **Full-sheet PNG** | `saveSpritesheet` → `downloadAsPNG` (`sources/models/download.ts:54-56`) | single `character-spritesheet.png`, 832 × (3456 + custom-anim heights) |
| **Credits TXT / CSV** | `downloadCreditsTxt/Csv` (`models/download.ts:58-72`) | `credits.txt` / `credits.csv`; CSV header `filename,notes,authors,licenses,urls` (`sources/utils/credits.ts:90-115`), scoped to the selected assets for the current body type |
| **ZIP: Split by animation** | `exportSplitAnimations` (`sources/state/zip.ts:70`) | zip `lpc_<bodyType>_animations_<timestamp>.zip` = the "**multiple sheets per animation** batch folder" mode: `standard/<anim>.png` (one strip PNG per standard animation, 832×num·64), `custom/<customAnim>.png` (stacked below y=3456), `credits/character.json` + `credits/credits.txt` + `credits/credits.csv` + `credits/metadata.json` |
| **ZIP: Split by item** | `exportSplitItemSheets` (`zip.ts:227`) | `lpc_<bodyType>_item_spritesheets_<ts>.zip`: `items/<NNN> <name>_<variant>.png` (each item re-rendered full sheet, zPos-prefixed filename via `getItemFileName`, `sources/utils/fileName.ts`), `credits/…` |
| **ZIP: Split by animation & item** | `exportSplitItemAnimations` (`zip.ts:346`) | `lpc_<bodyType>_item_animations_<ts>.zip`: `standard/<anim>/<NNN> <name>_<variant>.png` (skips `noExport` anims: watering, 1h_slash), `custom/<anim>/…`, `credits/…` |
| **ZIP: Split by animation & frame** | `exportIndividualFrames` (`zip.ts:647`) | `lpc_<bodyType>_individual_frames_<ts>.zip`: `standard/<anim>/<up\|left\|down\|right>/<frameNumber>.png` (+ `custom/…`); `credits/metadata.json` embeds `ANIMATION_CONFIGS`, `directions`, and `structure` |

All ZIP entries are PNG blobs from the composited offscreen canvas (animation modes) or fresh per-item renders (item modes). `credits/metadata.json` records `exportTimestamp`, `bodyType`, per-animation exported/failed lists, `frameSize: 64`, and profiler performance data. A headless MCP server would re-implement these with `node-canvas`/`sharp` + a zip lib; the algorithms live in `sources/canvas/{renderer,draw-frames,palette-recolor,mask}.ts` and `sources/state/{zip,credits,json,hash,path}.ts`.

**Auto preview:** the UI also renders a per-item preview crop (`preview_row`/`preview_column`/`preview_x_offset`/`preview_y_offset` in each def, defaults row 2 / col 0) and a full-sheet preview; not file outputs.

## 5. CREDITS & LICENSING

- **There is no `licenses/` folder.** The repo root `LICENSE` (35 KB) is **GPL-3.0 and governs the software only** (the generator app), not the art.
- **Art attribution is per-asset data**: every sheet-definition JSON carries a `credits: [{file, notes, authors, licenses, urls}]` array pointing at the `spritesheets/<file>` asset. Build step `scripts/generateSources/credits.ts` aggregates all of these into the top-level **`CREDITS.csv`** (13,915 rows, 3.98 MB; regenerated by `npm run validate-site-sources`). `CREDITS.csv` is a generated artifact — do not hand-edit.
- **License families** (`LICENSE_CONFIG`, `sources/state/constants.ts:22-57`):
  - `CC0` — public domain, no attribution required
  - `CC-BY-SA` (3.0/4.0) — must credit; **most restrictive**: derivatives must be distributed under CC-BY-SA 4.0+; no DRM
  - `CC-BY` (3.0+/3.0/4.0) — must credit; no DRM
  - `OGA-BY` (3.0/3.0+/4.0) — must credit; **DRM allowed** (OpenGameArt variant)
  - `GPL` (2.0/3.0) — derivatives under GPL 3.0+
  Individual asset license strings appear verbatim in `credits[].licenses` (e.g. `"OGA-BY 3.0"`, `"CC-BY-SA 3.0"`, `"GPL 3.0"`).
- **What a consuming tool MUST pass along** (README "Licensing and Attribution", lines 33-79): for any generated spritesheet or asset, distribute attribution for every non-CC0 author — either the whole `CREDITS.csv` or the composed per-selection credits (exactly what the tool's Credits TXT/CSV buttons and every ZIP's `credits/` folder contain). README:53: "you must at least credit all the authors (except for CC0 licensed artwork)". Also honor the stricter CC-BY-SA derivative/DRM terms. Recommended credit-screen statement is at README:74-77 (full artist list + LPC project link + CC-BY-SA 3.0 note + link to credits file).
- UI exposes **license filters** (`enabledLicenses`) that hide assets whose licenses aren't in the allowed set (`sources/state/filters.ts:115-151`), and credits auto-narrow to the files actually drawn for the chosen body type (`sources/utils/credits.ts:14-88`).
- `tools/` holds no license files; it's for asset *production* tooling (see §7).

## 6. REPO LAYOUT MAP

Top-level (file counts from `find -type f`, excluding `.git`/`node_modules`; du on disk):

| Path | Purpose | Files | Size |
|---|---|---|---|
| `spritesheets/` | **All composable layer PNGs** (20 top dirs: arms, backpack, beards, body, cape, dress, eyes, facial, feet, hair, hat, head, legs, neck, quiver, shadow, shield, shoulders, tools, torso, weapon) | 88,114 PNG | 312 MB |
| `sheet_definitions/` | Item + category JSON (source of truth: names, layers, zPos, animations, variants, recolors, credits, aliases) | 768 (657 items + 111 meta) | 3.2 MB |
| `palette_definitions/` | Recolor material palettes (body/eye/hair/cloth/metal/wood/all + meta + custom) | 22 | 64 KB |
| `sources/` | Browser app: Mithril UI + canvas compositing + state/catalog + ZIP export (TypeScript) | 71 | 612 KB |
| `scripts/` | Node build/test tooling: `generateSources/` (metadata + CREDITS.csv), `zPositioning/`, `zip/` profiling, coverage | 45 | 559 KB |
| `tests/` | node/mocha/browser specs + Playwright visual tests + fixtures (incl. `issue-382` golden ZIP layouts) | 194 | 1.4 MB |
| `tools/` | lpctools/Vitruvian asset-production tooling: `cutouts/` (3 PNG+md), `layout/` (universal{,-expanded}.json/.png), `masks/` (3 PNG), `palettes/` (56: standard, custom per-asset, lpcr↔ulpc & vitruvian conversions), 4 md docs | 71 | 745 KB |
| `vite/` | Vite plugins (item-metadata generator, spritesheet serving, CSS) | 9 | — |
| `styles/` | Bulma-derived CSS (critical/deferred split) | 8 | — |
| `readme-images/` | README screenshots | 2 | — |
| `lang/zh/` | Chinese README | 1 | — |
| `public/` | empty (`.gitkeep` only) | 1 | — |
| `.github/workflows/` | CI: ci, cls, deploy, lint, validate-site-sources, visual | 6 | — |
| root docs | `README.md`, `ARCHITECTURE.md` (13 KB wiring guide), `AGENTS.md` (invariants), `CONTRIBUTING.md` (57 KB), `CLS.md`, `PALETTE_RECOLOR_GUIDE.md` (15 KB), `PERFORMANCE_PROFILING.md` (17 KB), `CODE_OF_CONDUCT.md` | ~29 files | — |
| `CREDITS.csv` | generated attribution table | 1 | 3.98 MB |
| **Totals** | | **89,345 files excl. `.git`** (1,228 non-spritesheet) | **443 MB incl. .git; 323 MB excl.** |

**Essential for headless sheet generation** (an MCP server can ignore the rest): `spritesheets/` + `sheet_definitions/` + `palette_definitions/` + `sources/state/constants.ts` (ANIMATIONS/offsets/cycles) + `sources/custom-animations.ts` + the compositing algorithms in `sources/canvas/` + `sources/state/{zip,credits,json,path,palettes}.ts` + `tools/layout/*.json` (sheet geometry) + `CREDITS.csv` (or regenerate). **Browser-only:** `index.html`, `styles/`, `vite/`, `tests/`, `public/`, `.github/`, the Mithril components in `sources/components/` (Note: the pure state-logic modules (`state/json.ts`, `state/path.ts`, `state/palettes.ts`, `state/constants.ts`, `utils/credits.ts`) are dependency-injected and directly reusable in Node; `state/zip.ts` and `canvas/*` are browser-bound (Mithril + DOM canvas at module top) but their algorithms are the 1:1 port target for a headless compositor.) Node can run first-party `.ts` directly (Node ≥22.19; repo engines require 22.19+, CI uses 24).

---

## 7. UNIQUE / ADVANCED FEATURES

- **No "blank slip" / none-select**: to omit a category you simply don't select it (radio groups; empty `selections` entry = not drawn). No `blank`/`none` asset exists.
- **No scale export**: sheets are always 64 px frames at 1× (`COMPACT_FRAME_SIZE = 32` is preview-only; pinch-zoom is view-only). No 2×/3× option in code.
- **Custom PNG overlay** (`sources/components/advanced/AdvancedTools.ts`, `state.customUploadedImage` + `state.customImageZPos`): user uploads any PNG, drawn into every standard animation position at a custom z-position; recorded in `character.json` layers as `source: {kind:"custom"}`.
- **Facial variation depth**: 15 expressions + eyebrows (thick/thin) + 8 mustaches + 5 beards + 5 noses + wrinkles; tag-gated (`tags`/`required_tags`/`excluded_tags`, e.g. faces require tag `human`).
- **Ranged categories**: bows (normal/recurve/great + arrow `ammo`), crossbow, slingshot, boomerang — all under `weapons/ranged/` (7 items); melee = sword (9) + polearm (7) + blunt (4) + magic (7, incl. crystal/staff/loop/wand with metal recolors).
- **Hats**: 50 items — bicorne (athwart ×9 incl. trims/cockades/skulls, foreaft ×3), caps (8), formal (4), holiday (4 incl. elf/santa + trims), magic (8 incl. celestial moon hat + buckles + hat-belt), tricorne (8 + trims/stitching/skulls); plus hoods (cloth/hijab/sack-cloth), bandanas (4 + pirate-skull overlay), headbands (6 + hairties + runes).
- **Beards/buns**: beards (5), mustaches (8), buns/updos (`hair/extensions/ties/hairext_high_bun` "High Bun" + ponytails ×3 + knots/ties).
- **Wounds** (6), **prostheses** (hook hand, peg leg), **lizard tails/wings**, **fur body colors** (fur_black…fur_white), **zombie/skeleton body bases**, **wheelchair** (maps sit-animation frame 2 via `customAnimations.wheelchair`).
- **Transparency tools**: `applyTransparencyMask` keys out magenta `#FF2CE6` (`sources/canvas/mask.ts`); `showTransparencyGrid` (checkerboard, preview-only); `compactDisplay` (32 px preview frames).
- **Filters**: license (5 families) and animation (15) compatibility filters + search — `sources/models/{license-filters,animation-filters,search-control}.ts`.
- **z-ordering**: per-layer `zPos` (default 100; shadow 0, body 10, …) sorted low→behind; authoritative table `scripts/zPositioning/z_positions.csv` (889 rows, `npm run z-positions`).
- **Existing CLI / tooling in repo**:
  - npm scripts (Node 22.19+): `dev`, `build`, `test`, `lint`, `validate-site-sources` (regenerates `CREDITS.csv` + `scripts/zPositioning/z_positions.csv`), `z-positions`, `profile:zip*` (headless ZIP-export perf harness), `metadata:size*`, `fixture:issue382` (`scripts/fixture-builder.ts` → **Playwright headless run that drives all four ZIP exporters and snapshots their entry lists**, `scripts/issue382-golden-playwright.ts` + `tests/fixtures/issue-382/issue382-golden-runner.html`). This is the repo's own precedent for headless generation.
  - No gulpfile; no in-repo Python. `lpctools` is an **external** Python (conda/pip) tool; `tools/REBUILD.md` + `tools/LPCTOOLS.md` (WSL install) + `tools/VITRUVIAN.md` (convert assets to Vitruvian Studios single-palette LPCR sheets via `tools/palettes/conversions/*-to-vitruvian-*.json` + `lpctools colors recolor`).
  - `tools/layout/universal{,-expanded}.json` are the canonical sheet-geometry specs (frame_size [64,64], grid 13×21 / 13×54, per-cell animation/direction/frame mapping) — ideal input for a headless compositor.
  - Engine integrations (README:110-124): Godot 3.5/4.2 asset-library plugins, RPG Maker MZ starter kit (external repos).
  - Agent tooling present in repo: `.agents/skills/*` (canvas-render, catalog, generated-metadata, sheet-definition, …) and `AGENTS.md` invariants — e.g. "ship no new/derived PNG without a `credits` entry", "aliases go on the destination definition".

## 8. ASSET IDENTIFIER NORMALIZATION (folder/file ↔ friendly names)

- **Display names live in JSON, not filenames**: each def's `name` field is the UI label (`feet_shoes_sara.json` → "Sara Shoes"; `torso_armour_plate` → "Plate"). File/folder names are slugged identifiers; UI friendly names are the `name` values (plus `label` on `meta_*.json` categories, e.g. "Bicorne Athwart", "Human Heads"). `ucwords`/`capitalize` helpers (`sources/utils/helpers.ts`) are used only for default palette labels.
- **URL/JSON value encoding** (`sources/state/hash.ts:146-234`): `Name_with_underscores` + optional `_variant` + optional `|material.version.recolor`. Names come from `name.replace(/ /g,"_")`. Example: `body=Body_Color_light` (item "Body Color", color variant `light`), `shoes=Revised_Shoes_bluegray`.
- **Variant encoding**: variants map to on-disk subfolders or filenames. `variantToFilename(variant)` = `variant.replace(/ /g,"_")` (`sources/state/path.ts`, `helpers.ts:23`), e.g. variant `kite blue blue` → `kite_blue_blue` → folder `…/kite_blue_blue/`. Sprite path = `spritesheets/` + `layer_N.<bodyType>` base path + animation folder + optional `/` + variant file name + `.png` (`getSpritePath`, `path.ts:115-158`); if no variant is chosen the last `_`-segment of the `itemId` is used as the variant (`path.ts:143-147`).
- **Template paths**: layer paths may contain `${head}`-style placeholders resolved via `replace_in_path` + `es6DynamicTemplate` (`path.ts:161-195`), e.g. `head/faces/${head}/anger/` where `${head}` = the selected head's name (`Human_Male` → "male", `Human_Male_Small` → "male", `Human_Male_Elderly` → "elderly", see `face_angry.json`).
- **Animation name → folder mapping**: `ANIMATIONS[].folderName` (`combat` → `combat_idle`, `1h_slash`/`1h_backslash` → `backslash`, `1h_halfslash` → `halfslash`); `custom_animation` fields select 128/192-px oversize layouts (`tools/layout/universal-expanded.json` cells name them `cast/thrust/walk/slash/shoot/hurt/climb/idle/jump/sit/emote/run/combat_idle/backslash/halfslash`).
- **Aliases**: `aliases` in a def forward old hash values to new items/variants on the destination (`scripts/generateSources/aliases.ts`; examples: `"Epaulets_bronze": "metal.bronze"`, `"Sara_Shoes_sara": "all.lpcr.olivine"`, `"Hoofs_hoofs": "olive"`, wildcard `"wrinkes=*": "wrinkles=*"`, type-scoped `"belt=Other_belts_white": "Robe_Belt_white"`).
- **Credits filenames**: `credits[].file` values are `spritesheets/`-relative asset paths (without the per-animation `.png`), e.g. `"body/bodies/male"` — the full generated `CREDITS.csv` uses the concrete `body/bodies/male/spellcast.png` form.

### MCP design pointers (summary)
1. **Discovery tool**: read `sheet_definitions/**` (+ `meta_*` for category labels/priority/required) and `palette_definitions/**`; expose the generated `SlimByTypeNameRow` shape (`itemId, name, type_name, variants, recolors[0].variants`) as the item catalog, `ANIMATIONS`/`ANIMATION_CONFIGS`/`LICENSE_CONFIG`/`BODY_TYPES` as enum surfaces, and `tools/layout/universal-expanded.json` as the sheet-geometry spec.
2. **Generation tool**: given `{bodyType, selections}` (a `character.json`), composite `spritesheets/` layers onto an 832×(3456+custom) canvas using zPos-sorted draw calls, ANIMATION_OFFSETS rows, palette recolors (§2), optional transparency mask, then emit: full-sheet PNG, per-animation strip folder, per-item / per-frame folders, `character.json`, `credits.{txt,csv}` (with `metadata.json`) — mirroring the four `exportSplit*` shapes in §4.2.
3. **Attribution is mandatory**: every generated bundle must carry the composed credits (§5).

