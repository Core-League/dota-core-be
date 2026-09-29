/**
 * Dota 2 hero catalogue used to draw random heroes for 1v1 duels and to name
 * them in the API. Snapshot of OpenDota `/api/heroes` (127 heroes);
 * regenerate when Valve ships a new hero. `name` is Valve's
 * `npc_dota_hero_*` id — strip the prefix for CDN images.
 */
export interface DotaHero {
  id: number;
  name: string;
  localizedName: string;
}

export const DOTA_HEROES: readonly DotaHero[] = [
  { id: 1, name: 'npc_dota_hero_antimage', localizedName: 'Anti-Mage' },
  { id: 2, name: 'npc_dota_hero_axe', localizedName: 'Axe' },
  { id: 3, name: 'npc_dota_hero_bane', localizedName: 'Bane' },
  { id: 4, name: 'npc_dota_hero_bloodseeker', localizedName: 'Bloodseeker' },
  {
    id: 5,
    name: 'npc_dota_hero_crystal_maiden',
    localizedName: 'Crystal Maiden',
  },
  { id: 6, name: 'npc_dota_hero_drow_ranger', localizedName: 'Drow Ranger' },
  { id: 7, name: 'npc_dota_hero_earthshaker', localizedName: 'Earthshaker' },
  { id: 8, name: 'npc_dota_hero_juggernaut', localizedName: 'Juggernaut' },
  { id: 9, name: 'npc_dota_hero_mirana', localizedName: 'Mirana' },
  { id: 10, name: 'npc_dota_hero_morphling', localizedName: 'Morphling' },
  { id: 11, name: 'npc_dota_hero_nevermore', localizedName: 'Shadow Fiend' },
  {
    id: 12,
    name: 'npc_dota_hero_phantom_lancer',
    localizedName: 'Phantom Lancer',
  },
  { id: 13, name: 'npc_dota_hero_puck', localizedName: 'Puck' },
  { id: 14, name: 'npc_dota_hero_pudge', localizedName: 'Pudge' },
  { id: 15, name: 'npc_dota_hero_razor', localizedName: 'Razor' },
  { id: 16, name: 'npc_dota_hero_sand_king', localizedName: 'Sand King' },
  { id: 17, name: 'npc_dota_hero_storm_spirit', localizedName: 'Storm Spirit' },
  { id: 18, name: 'npc_dota_hero_sven', localizedName: 'Sven' },
  { id: 19, name: 'npc_dota_hero_tiny', localizedName: 'Tiny' },
  {
    id: 20,
    name: 'npc_dota_hero_vengefulspirit',
    localizedName: 'Vengeful Spirit',
  },
  { id: 21, name: 'npc_dota_hero_windrunner', localizedName: 'Windranger' },
  { id: 22, name: 'npc_dota_hero_zuus', localizedName: 'Zeus' },
  { id: 23, name: 'npc_dota_hero_kunkka', localizedName: 'Kunkka' },
  { id: 25, name: 'npc_dota_hero_lina', localizedName: 'Lina' },
  { id: 26, name: 'npc_dota_hero_lion', localizedName: 'Lion' },
  {
    id: 27,
    name: 'npc_dota_hero_shadow_shaman',
    localizedName: 'Shadow Shaman',
  },
  { id: 28, name: 'npc_dota_hero_slardar', localizedName: 'Slardar' },
  { id: 29, name: 'npc_dota_hero_tidehunter', localizedName: 'Tidehunter' },
  { id: 30, name: 'npc_dota_hero_witch_doctor', localizedName: 'Witch Doctor' },
  { id: 31, name: 'npc_dota_hero_lich', localizedName: 'Lich' },
  { id: 32, name: 'npc_dota_hero_riki', localizedName: 'Riki' },
  { id: 33, name: 'npc_dota_hero_enigma', localizedName: 'Enigma' },
  { id: 34, name: 'npc_dota_hero_tinker', localizedName: 'Tinker' },
  { id: 35, name: 'npc_dota_hero_sniper', localizedName: 'Sniper' },
  { id: 36, name: 'npc_dota_hero_necrolyte', localizedName: 'Necrophos' },
  { id: 37, name: 'npc_dota_hero_warlock', localizedName: 'Warlock' },
  { id: 38, name: 'npc_dota_hero_beastmaster', localizedName: 'Beastmaster' },
  { id: 39, name: 'npc_dota_hero_queenofpain', localizedName: 'Queen of Pain' },
  { id: 40, name: 'npc_dota_hero_venomancer', localizedName: 'Venomancer' },
  {
    id: 41,
    name: 'npc_dota_hero_faceless_void',
    localizedName: 'Faceless Void',
  },
  { id: 42, name: 'npc_dota_hero_skeleton_king', localizedName: 'Wraith King' },
  {
    id: 43,
    name: 'npc_dota_hero_death_prophet',
    localizedName: 'Death Prophet',
  },
  {
    id: 44,
    name: 'npc_dota_hero_phantom_assassin',
    localizedName: 'Phantom Assassin',
  },
  { id: 45, name: 'npc_dota_hero_pugna', localizedName: 'Pugna' },
  {
    id: 46,
    name: 'npc_dota_hero_templar_assassin',
    localizedName: 'Templar Assassin',
  },
  { id: 47, name: 'npc_dota_hero_viper', localizedName: 'Viper' },
  { id: 48, name: 'npc_dota_hero_luna', localizedName: 'Luna' },
  {
    id: 49,
    name: 'npc_dota_hero_dragon_knight',
    localizedName: 'Dragon Knight',
  },
  { id: 50, name: 'npc_dota_hero_dazzle', localizedName: 'Dazzle' },
  { id: 51, name: 'npc_dota_hero_rattletrap', localizedName: 'Clockwerk' },
  { id: 52, name: 'npc_dota_hero_leshrac', localizedName: 'Leshrac' },
  { id: 53, name: 'npc_dota_hero_furion', localizedName: "Nature's Prophet" },
  { id: 54, name: 'npc_dota_hero_life_stealer', localizedName: 'Lifestealer' },
  { id: 55, name: 'npc_dota_hero_dark_seer', localizedName: 'Dark Seer' },
  { id: 56, name: 'npc_dota_hero_clinkz', localizedName: 'Clinkz' },
  { id: 57, name: 'npc_dota_hero_omniknight', localizedName: 'Omniknight' },
  { id: 58, name: 'npc_dota_hero_enchantress', localizedName: 'Enchantress' },
  { id: 59, name: 'npc_dota_hero_huskar', localizedName: 'Huskar' },
  {
    id: 60,
    name: 'npc_dota_hero_night_stalker',
    localizedName: 'Night Stalker',
  },
  { id: 61, name: 'npc_dota_hero_broodmother', localizedName: 'Broodmother' },
  {
    id: 62,
    name: 'npc_dota_hero_bounty_hunter',
    localizedName: 'Bounty Hunter',
  },
  { id: 63, name: 'npc_dota_hero_weaver', localizedName: 'Weaver' },
  { id: 64, name: 'npc_dota_hero_jakiro', localizedName: 'Jakiro' },
  { id: 65, name: 'npc_dota_hero_batrider', localizedName: 'Batrider' },
  { id: 66, name: 'npc_dota_hero_chen', localizedName: 'Chen' },
  { id: 67, name: 'npc_dota_hero_spectre', localizedName: 'Spectre' },
  {
    id: 68,
    name: 'npc_dota_hero_ancient_apparition',
    localizedName: 'Ancient Apparition',
  },
  { id: 69, name: 'npc_dota_hero_doom_bringer', localizedName: 'Doom' },
  { id: 70, name: 'npc_dota_hero_ursa', localizedName: 'Ursa' },
  {
    id: 71,
    name: 'npc_dota_hero_spirit_breaker',
    localizedName: 'Spirit Breaker',
  },
  { id: 72, name: 'npc_dota_hero_gyrocopter', localizedName: 'Gyrocopter' },
  { id: 73, name: 'npc_dota_hero_alchemist', localizedName: 'Alchemist' },
  { id: 74, name: 'npc_dota_hero_invoker', localizedName: 'Invoker' },
  { id: 75, name: 'npc_dota_hero_silencer', localizedName: 'Silencer' },
  {
    id: 76,
    name: 'npc_dota_hero_obsidian_destroyer',
    localizedName: 'Outworld Destroyer',
  },
  { id: 77, name: 'npc_dota_hero_lycan', localizedName: 'Lycan' },
  { id: 78, name: 'npc_dota_hero_brewmaster', localizedName: 'Brewmaster' },
  { id: 79, name: 'npc_dota_hero_shadow_demon', localizedName: 'Shadow Demon' },
  { id: 80, name: 'npc_dota_hero_lone_druid', localizedName: 'Lone Druid' },
  { id: 81, name: 'npc_dota_hero_chaos_knight', localizedName: 'Chaos Knight' },
  { id: 82, name: 'npc_dota_hero_meepo', localizedName: 'Meepo' },
  { id: 83, name: 'npc_dota_hero_treant', localizedName: 'Treant Protector' },
  { id: 84, name: 'npc_dota_hero_ogre_magi', localizedName: 'Ogre Magi' },
  { id: 85, name: 'npc_dota_hero_undying', localizedName: 'Undying' },
  { id: 86, name: 'npc_dota_hero_rubick', localizedName: 'Rubick' },
  { id: 87, name: 'npc_dota_hero_disruptor', localizedName: 'Disruptor' },
  { id: 88, name: 'npc_dota_hero_nyx_assassin', localizedName: 'Nyx Assassin' },
  { id: 89, name: 'npc_dota_hero_naga_siren', localizedName: 'Naga Siren' },
  {
    id: 90,
    name: 'npc_dota_hero_keeper_of_the_light',
    localizedName: 'Keeper of the Light',
  },
  { id: 91, name: 'npc_dota_hero_wisp', localizedName: 'Io' },
  { id: 92, name: 'npc_dota_hero_visage', localizedName: 'Visage' },
  { id: 93, name: 'npc_dota_hero_slark', localizedName: 'Slark' },
  { id: 94, name: 'npc_dota_hero_medusa', localizedName: 'Medusa' },
  {
    id: 95,
    name: 'npc_dota_hero_troll_warlord',
    localizedName: 'Troll Warlord',
  },
  { id: 96, name: 'npc_dota_hero_centaur', localizedName: 'Centaur Warrunner' },
  { id: 97, name: 'npc_dota_hero_magnataur', localizedName: 'Magnus' },
  { id: 98, name: 'npc_dota_hero_shredder', localizedName: 'Timbersaw' },
  { id: 99, name: 'npc_dota_hero_bristleback', localizedName: 'Bristleback' },
  { id: 100, name: 'npc_dota_hero_tusk', localizedName: 'Tusk' },
  {
    id: 101,
    name: 'npc_dota_hero_skywrath_mage',
    localizedName: 'Skywrath Mage',
  },
  { id: 102, name: 'npc_dota_hero_abaddon', localizedName: 'Abaddon' },
  { id: 103, name: 'npc_dota_hero_elder_titan', localizedName: 'Elder Titan' },
  {
    id: 104,
    name: 'npc_dota_hero_legion_commander',
    localizedName: 'Legion Commander',
  },
  { id: 105, name: 'npc_dota_hero_techies', localizedName: 'Techies' },
  {
    id: 106,
    name: 'npc_dota_hero_ember_spirit',
    localizedName: 'Ember Spirit',
  },
  {
    id: 107,
    name: 'npc_dota_hero_earth_spirit',
    localizedName: 'Earth Spirit',
  },
  {
    id: 108,
    name: 'npc_dota_hero_abyssal_underlord',
    localizedName: 'Underlord',
  },
  { id: 109, name: 'npc_dota_hero_terrorblade', localizedName: 'Terrorblade' },
  { id: 110, name: 'npc_dota_hero_phoenix', localizedName: 'Phoenix' },
  { id: 111, name: 'npc_dota_hero_oracle', localizedName: 'Oracle' },
  {
    id: 112,
    name: 'npc_dota_hero_winter_wyvern',
    localizedName: 'Winter Wyvern',
  },
  { id: 113, name: 'npc_dota_hero_arc_warden', localizedName: 'Arc Warden' },
  { id: 114, name: 'npc_dota_hero_monkey_king', localizedName: 'Monkey King' },
  { id: 119, name: 'npc_dota_hero_dark_willow', localizedName: 'Dark Willow' },
  { id: 120, name: 'npc_dota_hero_pangolier', localizedName: 'Pangolier' },
  { id: 121, name: 'npc_dota_hero_grimstroke', localizedName: 'Grimstroke' },
  { id: 123, name: 'npc_dota_hero_hoodwink', localizedName: 'Hoodwink' },
  { id: 126, name: 'npc_dota_hero_void_spirit', localizedName: 'Void Spirit' },
  { id: 128, name: 'npc_dota_hero_snapfire', localizedName: 'Snapfire' },
  { id: 129, name: 'npc_dota_hero_mars', localizedName: 'Mars' },
  { id: 131, name: 'npc_dota_hero_ringmaster', localizedName: 'Ringmaster' },
  { id: 135, name: 'npc_dota_hero_dawnbreaker', localizedName: 'Dawnbreaker' },
  { id: 136, name: 'npc_dota_hero_marci', localizedName: 'Marci' },
  {
    id: 137,
    name: 'npc_dota_hero_primal_beast',
    localizedName: 'Primal Beast',
  },
  { id: 138, name: 'npc_dota_hero_muerta', localizedName: 'Muerta' },
  { id: 145, name: 'npc_dota_hero_kez', localizedName: 'Kez' },
  { id: 155, name: 'npc_dota_hero_largo', localizedName: 'Largo' },
];

const BY_ID = new Map(DOTA_HEROES.map((h) => [h.id, h]));

export function heroById(id: number): DotaHero | null {
  return BY_ID.get(id) ?? null;
}

/** `n` distinct random heroes. */
export function pickRandomHeroes(n: number): DotaHero[] {
  const pool = [...DOTA_HEROES];
  const out: DotaHero[] = [];
  while (out.length < n && pool.length) {
    const ix = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(ix, 1)[0]);
  }
  return out;
}
