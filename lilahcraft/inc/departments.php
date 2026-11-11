<?php
/**
 * The Market's departments.
 *
 * Crate sorts every item into departments: the tabs of the Store and the Market in game. As shipped there are
 * eight, in this order: Blocks, Materials, Food, Tools, Combat, Redstone, Collectibles, Misc.
 *
 * From HomeCraftMgmt 0.38.8 the Market feed says so itself: "departments" at the top level (the tab names in
 * order, from the server's marketplace.departments) and a "department" on every item. The site then uses those,
 * so a renamed tab, an extra one or an item an admin moved (marketplace.category_overrides) reads on the site as
 * it does in game. An older feed (0.38.7) sends neither, and the site works it out as the plugin does. Either way
 * lilahcraft_department() answers with one of the tabs in use:
 *
 *   1. the feed's own "department" for the item, when it names one of the tabs (any case);
 *   2. the table below: the plugin's classifier (marketplace/Categorizer.java) run over the 263 materials the
 *      live market had on 10 November 2026. It matches the server's startup line: Blocks 106, Materials 59,
 *      Food 29, Tools 15, Combat 21, Redstone 14, Collectibles 12, Misc 7;
 *   3. for a material that isn't in the table (an item added to Crate since), the plugin's name rules
 *      (lilahcraft_department_by_name());
 *   4. Misc, the plugin's own last resort. Where no name rule decides, the plugin asks the server whether the
 *      item can be eaten or placed; the site can't, so such an item reads Misc until it is added to the table.
 *
 * Steps 2 to 4 answer in the shipped names. When the feed's tabs don't have that name (a server that renamed
 * its departments, and an item that came without a usable one), the item goes under the last tab, which is what
 * the plugin does with a name it doesn't know.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The eight departments HomeCraftMgmt ships, in the game's tab order: the tabs when the feed doesn't send its own.
 * (assets/js/lc-data.js has the same list; tools/check-theme.php checks the two agree.)
 *
 * @return string[]
 */
function lilahcraft_departments() {
	return array( 'Blocks', 'Materials', 'Food', 'Tools', 'Combat', 'Redstone', 'Collectibles', 'Misc' );
}

/**
 * Material => department for the live market's items (see the file header for where it comes from).
 *
 * @return array
 */
function lilahcraft_department_table() {
	static $table = null;
	if ( null !== $table ) {
		return $table;
	}
	$lists = array(
		'Blocks'       => 'ACACIA_LOG ANDESITE ANVIL BAMBOO BARREL BASALT BEACON BELL BIRCH_LOG BIRCH_SAPLING BLACKSTONE BLACK_CONCRETE'
			. ' BLAST_FURNACE BOOKSHELF BREWING_STAND BRICKS CACTUS CALCITE CAMPFIRE CAULDRON CHERRY_LOG CHERRY_SAPLING CHEST CLAY'
			. ' COARSE_DIRT COBBLED_DEEPSLATE COBBLESTONE COMPOSTER CONDUIT CRAFTING_TABLE CRIMSON_STEM CRYING_OBSIDIAN DARK_OAK_LOG'
			. ' DARK_OAK_SAPLING DEEPSLATE DIORITE DIRT DRIPSTONE_BLOCK ENCHANTING_TABLE ENDER_CHEST END_ROD END_STONE FLOWER_POT'
			. ' FURNACE GLASS GLASS_PANE GLOWSTONE GRANITE GRAVEL HAY_BLOCK IRON_CHAIN JUNGLE_LOG JUNGLE_SAPLING KELP LADDER LANTERN'
			. ' LECTERN LILY_PAD LODESTONE MAGMA_BLOCK MANGROVE_LOG MOSSY_COBBLESTONE MOSS_BLOCK MUD MYCELIUM NETHERRACK NETHER_BRICKS'
			. ' OAK_LOG OAK_SAPLING OBSIDIAN PACKED_MUD POINTED_DRIPSTONE PRISMARINE PUMPKIN PURPUR_BLOCK RED_SAND RESPAWN_ANCHOR SAND'
			. ' SANDSTONE SCAFFOLDING SCULK SCULK_CATALYST SCULK_SHRIEKER SEA_LANTERN SHROOMLIGHT SMITHING_TABLE SMOKER SMOOTH_STONE'
			. ' SOUL_LANTERN SOUL_SAND SOUL_SOIL SPONGE SPORE_BLOSSOM SPRUCE_LOG SPRUCE_SAPLING STONE STONE_BRICKS SUGAR_CANE'
			. ' TERRACOTTA TORCH TUFF VINE WARPED_STEM WHITE_BED WHITE_CONCRETE WHITE_WOOL',
		'Materials'    => 'AMETHYST_SHARD BLACK_DYE BLAZE_POWDER BLAZE_ROD BLUE_DYE BONE BONE_MEAL BOOK BRICK BROWN_DYE CHARCOAL CLAY_BALL COAL'
			. ' COPPER_INGOT DIAMOND EGG EMERALD ENDER_PEARL FEATHER FERMENTED_SPIDER_EYE FLINT GHAST_TEAR GLOWSTONE_DUST GLOW_INK_SAC'
			. ' GOLD_INGOT GOLD_NUGGET GREEN_DYE GUNPOWDER HONEYCOMB INK_SAC IRON_INGOT IRON_NUGGET LAPIS_LAZULI LEATHER MAGMA_CREAM'
			. ' NAUTILUS_SHELL NETHERITE_INGOT NETHERITE_SCRAP NETHER_WART PAPER PHANTOM_MEMBRANE PRISMARINE_CRYSTALS PRISMARINE_SHARD'
			. ' PURPLE_DYE QUARTZ RAW_COPPER RAW_GOLD RAW_IRON RED_DYE ROTTEN_FLESH SLIME_BALL SPIDER_EYE STICK STRING SUGAR WHEAT'
			. ' WHEAT_SEEDS WHITE_DYE YELLOW_DYE',
		'Food'         => 'APPLE BAKED_POTATO BEEF BEETROOT BREAD CARROT CHICKEN CHORUS_FRUIT COD COOKED_BEEF COOKED_CHICKEN COOKED_COD'
			. ' COOKED_MUTTON COOKED_PORKCHOP COOKED_SALMON DRIED_KELP ENCHANTED_GOLDEN_APPLE GLOW_BERRIES GOLDEN_APPLE GOLDEN_CARROT'
			. ' HONEY_BOTTLE MELON_SLICE MUTTON PORKCHOP POTATO PUFFERFISH SALMON SWEET_BERRIES TROPICAL_FISH',
		'Tools'        => 'BUCKET CLOCK COMPASS DIAMOND_PICKAXE ENDER_EYE FISHING_ROD FLINT_AND_STEEL IRON_PICKAXE LEAD MINECART NAME_TAG SADDLE'
			. ' SHEARS SPYGLASS WRITABLE_BOOK',
		'Combat'       => 'ARROW BOW CROSSBOW DIAMOND_AXE DIAMOND_BOOTS DIAMOND_CHESTPLATE DIAMOND_HELMET DIAMOND_LEGGINGS DIAMOND_SWORD ELYTRA'
			. ' FIREWORK_ROCKET IRON_AXE IRON_BOOTS IRON_CHESTPLATE IRON_HELMET IRON_LEGGINGS IRON_SWORD SHIELD TNT TRIDENT'
			. ' TURTLE_HELMET',
		'Redstone'     => 'COMPARATOR DISPENSER DROPPER HOPPER LIGHTNING_ROD OBSERVER PISTON POWERED_RAIL RAIL REDSTONE REDSTONE_TORCH REPEATER'
			. ' SCULK_SENSOR STICKY_PISTON',
		'Collectibles' => 'DRAGON_EGG DRAGON_HEAD ECHO_SHARD GLOW_ITEM_FRAME HEART_OF_THE_SEA ITEM_FRAME MUSIC_DISC_13 MUSIC_DISC_PIGSTEP'
			. ' NETHER_STAR PAINTING TOTEM_OF_UNDYING WITHER_SKELETON_SKULL',
		'Misc'         => 'ARMOR_STAND COCOA_BEANS DRAGON_BREATH EXPERIENCE_BOTTLE NETHERITE_UPGRADE_SMITHING_TEMPLATE RABBIT_FOOT SHULKER_SHELL',
	);
	$table = array();
	foreach ( $lists as $department => $materials ) {
		foreach ( explode( ' ', $materials ) as $material ) {
			$table[ $material ] = $department;
		}
	}
	return $table;
}

/**
 * The department a material's name alone decides, as HomeCraftMgmt's Categorizer.byName() does, or '' when the name
 * doesn't decide. The order matters, specific before general: DIAMOND_SWORD is Combat before DIAMOND is a material,
 * REDSTONE_BLOCK is Redstone before a _BLOCK is a block.
 *
 * @param string $material Bukkit material name, upper case.
 * @return string
 */
function lilahcraft_department_by_name( $material ) {
	static $rules = array(
		'Combat'       => '/_(HELMET|CHESTPLATE|LEGGINGS|BOOTS|HORSE_ARMOR|ARMOR_TRIM_SMITHING_TEMPLATE|SWORD|AXE|ARROW)$'
			. '|^(SHIELD|ELYTRA|WOLF_ARMOR|BOW|CROSSBOW|TRIDENT|MACE|ARROW|TNT|FIREWORK_ROCKET)$/D',
		'Tools'        => '/_(PICKAXE|SHOVEL|HOE|BUCKET|MINECART|BOAT|RAFT)$'
			. '|^(SHEARS|FLINT_AND_STEEL|FISHING_ROD|BUCKET|COMPASS|RECOVERY_COMPASS|CLOCK|SPYGLASS|BRUSH|LEAD|NAME_TAG|SADDLE|MAP|FILLED_MAP'
			. '|WRITABLE_BOOK|MINECART|ENDER_EYE)$/D',
		'Redstone'     => '/_(BUTTON|PRESSURE_PLATE)$'
			. '|^(REDSTONE|REDSTONE_TORCH|REDSTONE_BLOCK|REPEATER|COMPARATOR|OBSERVER|PISTON|STICKY_PISTON|HOPPER|DISPENSER|DROPPER|LEVER'
			. '|TRIPWIRE_HOOK|DAYLIGHT_DETECTOR|TARGET|SLIME_BLOCK|HONEY_BLOCK|REDSTONE_LAMP|NOTE_BLOCK|POWERED_RAIL|DETECTOR_RAIL'
			. '|ACTIVATOR_RAIL|RAIL|SCULK_SENSOR|CALIBRATED_SCULK_SENSOR|LIGHTNING_ROD|CRAFTER)$/D',
		'Collectibles' => '/_(HEAD|SKULL|BANNER|POTTERY_SHERD|BANNER_PATTERN)$|^MUSIC_DISC'
			. '|^(PAINTING|ITEM_FRAME|GLOW_ITEM_FRAME|TOTEM_OF_UNDYING|ENCHANTED_BOOK|NETHER_STAR|DRAGON_EGG|HEART_OF_THE_SEA|ECHO_SHARD)$/D',
		'Food'         => '/_(STEW|APPLE)$|^COOKED_'
			. '|^(CAKE|MILK_BUCKET|HONEY_BOTTLE|BREAD|BEEF|PORKCHOP|CHICKEN|MUTTON|RABBIT|COD|SALMON|TROPICAL_FISH|PUFFERFISH|CARROT|POTATO'
			. '|BAKED_POTATO|BEETROOT|MELON_SLICE|SWEET_BERRIES|GLOW_BERRIES|CHORUS_FRUIT|DRIED_KELP|COOKIE|PUMPKIN_PIE)$/D',
		'Materials'    => '/_(INGOT|NUGGET|DYE|SEEDS)$|^RAW_'
			. '|^(DIAMOND|EMERALD|LAPIS_LAZULI|QUARTZ|AMETHYST_SHARD|NETHERITE_SCRAP|COAL|CHARCOAL|GLOWSTONE_DUST|BLAZE_ROD|BLAZE_POWDER'
			. '|GUNPOWDER|STICK|FLINT|CLAY_BALL|BRICK|NETHER_BRICK|PAPER|BOOK|LEATHER|RABBIT_HIDE|STRING|FEATHER|BONE|BONE_MEAL|SLIME_BALL'
			. '|ENDER_PEARL|GHAST_TEAR|MAGMA_CREAM|SPIDER_EYE|FERMENTED_SPIDER_EYE|ROTTEN_FLESH|PRISMARINE_SHARD|PRISMARINE_CRYSTALS'
			. '|NAUTILUS_SHELL|PHANTOM_MEMBRANE|INK_SAC|GLOW_INK_SAC|HONEYCOMB|TURTLE_SCUTE|SCUTE|SUGAR|EGG|WHEAT|NETHER_WART|GLASS_BOTTLE'
			. '|AMETHYST_CLUSTER|BREEZE_ROD|HEAVY_CORE|RESIN_CLUMP)$/D',
		'Blocks'       => '/_(LOG|WOOD|PLANKS|SLAB|STAIRS|FENCE|FENCE_GATE|WALL|DOOR|TRAPDOOR|LEAVES|SAPLING|ORE|BLOCK|BRICKS|TERRACOTTA|CONCRETE'
			. '|CONCRETE_POWDER|WOOL|CARPET|GLASS|GLASS_PANE|SHULKER_BOX|BED|SIGN|HANGING_SIGN|ROOTS|FUNGUS|MUSHROOM|CORAL|CORAL_BLOCK'
			. '|CORAL_FAN|FLOWER|TULIP|ORCHID|BUSH)$'
			. '|^(STONE|COBBLESTONE|DIRT|GRASS_BLOCK|SAND|GRAVEL|OBSIDIAN|NETHERRACK|END_STONE|GLASS|ICE|SNOW|SNOW_BLOCK|CLAY|BAMBOO'
			. '|SUGAR_CANE|KELP|VINE|CACTUS|PUMPKIN|MELON|TORCH|LANTERN|CHEST|BARREL|FURNACE|CRAFTING_TABLE|SCAFFOLDING)$/D',
	);
	foreach ( $rules as $department => $rule ) {
		if ( preg_match( $rule, (string) $material ) ) {
			return $department;
		}
	}
	return '';
}

/**
 * The tab a name stands for: the one of $tabs that reads the same in any case, as that tab spells it, or ''.
 *
 * @param mixed    $name A department name.
 * @param string[] $tabs The tabs in use.
 * @return string
 */
function lilahcraft_department_match( $name, $tabs ) {
	if ( ! is_string( $name ) || '' === trim( $name ) ) {
		return '';
	}
	$lower = function_exists( 'mb_strtolower' ) ? 'mb_strtolower' : 'strtolower';
	$name  = $lower( trim( $name ) );
	foreach ( $tabs as $tab ) {
		if ( $lower( $tab ) === $name ) {
			return $tab;
		}
	}
	return '';
}

/**
 * An item's department: always one of the tabs in use.
 *
 * @param string        $material Bukkit material name, upper case (the feed's "material").
 * @param mixed         $given    The feed's own "department" for the item, if it sent one.
 * @param string[]|null $tabs     The tabs in use: the feed's "departments" (cleaned, at least one), or null for the
 *                                eight in lilahcraft_departments().
 * @return string
 */
function lilahcraft_department( $material, $given = null, $tabs = null ) {
	$tabs = ( is_array( $tabs ) && $tabs ) ? array_values( $tabs ) : lilahcraft_departments();
	$tab  = lilahcraft_department_match( $given, $tabs );
	if ( '' !== $tab ) {
		return $tab;
	}
	$table = lilahcraft_department_table();
	$own   = isset( $table[ $material ] ) ? $table[ $material ] : lilahcraft_department_by_name( $material );
	$tab   = lilahcraft_department_match( '' !== $own ? $own : 'Misc', $tabs );
	// A server that renamed its tabs: a name the tabs don't have goes under the last one, as in game.
	return '' !== $tab ? $tab : $tabs[ count( $tabs ) - 1 ];
}
