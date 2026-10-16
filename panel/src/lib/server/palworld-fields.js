// Alla inställningar i PalWorldSettings.ini som panelen visar, med svensk och engelsk text.
// Typen läses från filen (True/False = bool, 1.000000 = float, "text" = text, (A,B) = lista),
// men kan styras här. Nycklar som inte finns i listan visas ändå under "Övrigt".
//
// [nyckel, grupp, svensk text, engelsk text, extra]
// extra: { type, options: [[värde, sv, en]], min, max, step, hint: [sv, en], secret }

export const PAL_GROUPS = [
	['server', 'Server och anslutning', 'Server and connection'],
	['rules', 'Spelregler', 'Game rules'],
	['player', 'Spelare', 'Players'],
	['pal', 'Pals', 'Pals'],
	['world', 'Världen och resurser', 'World and resources'],
	['base', 'Baser och byggen', 'Bases and buildings'],
	['guild', 'Guild', 'Guild'],
	['pvp', 'PvP och död', 'PvP and death'],
	['chat', 'Chatt och röst', 'Chat and voice'],
	['advanced', 'Avancerat och prestanda', 'Advanced and performance'],
	['other', 'Övrigt (okända nycklar)', 'Other (unknown keys)']
];

const rate = { type: 'float', min: 0, max: 50, step: 0.1 };

export const PAL_FIELDS = [
	// ---- server
	['ServerName', 'server', 'Servernamn', 'Server name'],
	['ServerDescription', 'server', 'Beskrivning', 'Description'],
	['ServerPassword', 'server', 'Lösenord för att gå med (tomt = öppen)', 'Join password (empty = open)'],
	['AdminPassword', 'server', 'Adminlösenord (behövs för panelen och /AdminPassword i spelet)', 'Admin password (used by the panel and /AdminPassword in game)', { secret: true }],
	['ServerPlayerMaxNum', 'server', 'Max spelare på servern', 'Max players on the server', { min: 1, max: 32 }],
	['CoopPlayerMaxNum', 'server', 'Max spelare i co-op-grupp', 'Max players in a co-op party', { min: 1, max: 32 }],
	['PublicPort', 'server', 'Spelport (UDP)', 'Game port (UDP)', { min: 1, max: 65535 }],
	['PublicIP', 'server', 'Publik IP (tomt = automatiskt)', 'Public IP (empty = automatic)'],
	['Region', 'server', 'Region', 'Region', { hint: ['T.ex. EU. Visas i serverlistan.', 'E.g. EU. Shown in the server list.'] }],
	['bUseAuth', 'server', 'Kräv Steam-inloggning (auth)', 'Require Steam authentication'],
	['BanListURL', 'server', 'Gemensam banlista (URL)', 'Shared ban list (URL)'],
	['CrossplayPlatforms', 'server', 'Plattformar som får ansluta', 'Platforms allowed to join', { type: 'list', options: [['Steam', 'Steam', 'Steam'], ['Xbox', 'Xbox', 'Xbox'], ['PS5', 'PS5', 'PS5'], ['Mac', 'Mac', 'Mac']] }],
	['bAllowClientMod', 'server', 'Tillåt spelare med klientmods', 'Allow players with client mods'],
	['bShowPlayerList', 'server', 'Visa spelarlistan i menyn (ESC)', 'Show player list in the menu (ESC)'],
	['bIsMultiplay', 'server', 'Multiplayer-flagga', 'Multiplayer flag'],
	['RESTAPIEnabled', 'server', 'REST API på (panelen behöver det)', 'REST API on (the panel needs it)'],
	['RESTAPIPort', 'server', 'REST API-port', 'REST API port', { min: 1, max: 65535 }],
	['RCONEnabled', 'server', 'RCON på', 'RCON on'],
	['RCONPort', 'server', 'RCON-port', 'RCON port', { min: 1, max: 65535 }],

	// ---- spelregler
	['Difficulty', 'rules', 'Svårighetsgrad', 'Difficulty', { type: 'select', options: [['None', 'Egen (värdena nedan)', 'Custom (values below)'], ['Casual', 'Lätt', 'Casual'], ['Normal', 'Normal', 'Normal'], ['Hard', 'Svår', 'Hard']] }],
	['bHardcore', 'rules', 'Hardcore (dör man är karaktären borta)', 'Hardcore (death deletes the character)'],
	['bCharacterRecreateInHardcore', 'rules', 'Får skapa ny karaktär i hardcore', 'Allow new character in hardcore'],
	['bPalLost', 'rules', 'Pals försvinner när man dör', 'Pals are lost on death'],
	['RandomizerType', 'rules', 'Slumpa pals i världen', 'Randomize pals in the world', { type: 'select', options: [['None', 'Av', 'Off'], ['Region', 'Per område', 'Per region'], ['All', 'Helt slumpat', 'Fully random']] }],
	['RandomizerSeed', 'rules', 'Frö för slumpningen', 'Randomizer seed'],
	['bIsRandomizerPalLevelRandom', 'rules', 'Slumpa även nivåer', 'Randomize levels too'],
	['bEnableFastTravel', 'rules', 'Snabbresor', 'Fast travel'],
	['bEnableFastTravelOnlyBaseCamp', 'rules', 'Snabbresor bara till baser', 'Fast travel only to bases'],
	['bIsStartLocationSelectByMap', 'rules', 'Välj startplats på kartan', 'Pick start location on the map'],
	['bExistPlayerAfterLogout', 'rules', 'Karaktären blir kvar i världen efter utloggning', 'Character stays in the world after logout'],
	['bEnableNonLoginPenalty', 'rules', 'Straff om man inte loggat in på länge', 'Penalty for not logging in for a long time'],
	['bEnableInvaderEnemy', 'rules', 'Räder mot baser', 'Raids on bases'],
	['EnablePredatorBossPal', 'rules', 'Predator-bossar', 'Predator bosses'],
	['SupplyDropSpan', 'rules', 'Minuter mellan supply drops', 'Minutes between supply drops', { min: 1, max: 1440 }],
	['bActiveUNKO', 'rules', 'Pals bajsar (UNKO)', 'Pals poop (UNKO)'],
	['bEnableAimAssistPad', 'rules', 'Aim assist för handkontroll', 'Aim assist for controller'],
	['bEnableAimAssistKeyboard', 'rules', 'Aim assist för tangentbord', 'Aim assist for keyboard'],
	['DenyTechnologyList', 'rules', 'Spärrad teknik (kommaseparerad)', 'Blocked technology (comma separated)'],
	['bAllowGlobalPalboxExport', 'rules', 'Får exportera till globala Palboxen', 'Allow export to the global Palbox'],
	['bAllowGlobalPalboxImport', 'rules', 'Får importera från globala Palboxen', 'Allow import from the global Palbox'],
	['bAllowEnhanceStat_Health', 'rules', 'Får förstärka HP (statyer)', 'Allow enhancing health (statues)'],
	['bAllowEnhanceStat_Attack', 'rules', 'Får förstärka attack', 'Allow enhancing attack'],
	['bAllowEnhanceStat_Stamina', 'rules', 'Får förstärka stamina', 'Allow enhancing stamina'],
	['bAllowEnhanceStat_Weight', 'rules', 'Får förstärka bärvikt', 'Allow enhancing carry weight'],
	['bAllowEnhanceStat_WorkSpeed', 'rules', 'Får förstärka arbetshastighet', 'Allow enhancing work speed'],

	// ---- spelare
	['ExpRate', 'player', 'XP', 'XP', rate],
	['PlayerDamageRateAttack', 'player', 'Skada spelaren gör', 'Damage players deal', rate],
	['PlayerDamageRateDefense', 'player', 'Skada spelaren tar', 'Damage players take', rate],
	['PlayerStomachDecreaceRate', 'player', 'Hunger (lägre = långsammare)', 'Hunger (lower = slower)', rate],
	['PlayerStaminaDecreaceRate', 'player', 'Stamina-förbrukning', 'Stamina use', rate],
	['PlayerAutoHPRegeneRate', 'player', 'HP-återhämtning', 'HP regeneration', rate],
	['PlayerAutoHpRegeneRateInSleep', 'player', 'HP-återhämtning när man sover', 'HP regeneration while sleeping', rate],
	['ItemWeightRate', 'player', 'Vikt på föremål (0 = viktlöst)', 'Item weight (0 = weightless)', rate],
	['EquipmentDurabilityDamageRate', 'player', 'Slitage på utrustning', 'Equipment wear', rate],
	['ItemCorruptionMultiplier', 'player', 'Hur fort mat ruttnar', 'How fast food spoils', rate],
	['FishingDifficultyRate', 'player', 'Svårighet att fiska', 'Fishing difficulty', rate],
	['BlockRespawnTime', 'player', 'Väntetid innan respawn (sekunder)', 'Respawn wait (seconds)', { type: 'float', min: 0, max: 600, step: 1 }],
	['RespawnPenaltyDurationThreshold', 'player', 'Respawn-straff: gräns (sekunder)', 'Respawn penalty: threshold (seconds)', { type: 'float', min: 0, max: 3600, step: 1 }],
	['RespawnPenaltyTimeScale', 'player', 'Respawn-straff: faktor', 'Respawn penalty: multiplier', rate],

	// ---- pals
	['PalCaptureRate', 'pal', 'Fångstchans', 'Capture rate', rate],
	['PalSpawnNumRate', 'pal', 'Antal pals i världen', 'Number of pals in the world', { type: 'float', min: 0.1, max: 5, step: 0.1, hint: ['Över 3 kan göra servern långsam.', 'Above 3 can slow the server down.'] }],
	['PalDamageRateAttack', 'pal', 'Skada pals gör', 'Damage pals deal', rate],
	['PalDamageRateDefense', 'pal', 'Skada pals tar', 'Damage pals take', rate],
	['PalStomachDecreaceRate', 'pal', 'Hunger pals', 'Pal hunger', rate],
	['PalStaminaDecreaceRate', 'pal', 'Stamina pals', 'Pal stamina', rate],
	['PalAutoHPRegeneRate', 'pal', 'HP-återhämtning pals', 'Pal HP regeneration', rate],
	['PalAutoHpRegeneRateInSleep', 'pal', 'HP-återhämtning pals i Palboxen', 'Pal HP regeneration in the Palbox', rate],
	['PalEggDefaultHatchingTime', 'pal', 'Kläcktid för ägg (timmar)', 'Egg hatching time (hours)', { type: 'float', min: 0, max: 240, step: 0.5 }],
	['WorkSpeedRate', 'pal', 'Arbetshastighet i basen', 'Work speed at bases', rate],
	['MonsterFarmActionSpeedRate', 'pal', 'Hastighet på ranchen', 'Ranch speed', rate],

	// ---- världen
	['DayTimeSpeedRate', 'world', 'Dagens hastighet', 'Day speed', rate],
	['NightTimeSpeedRate', 'world', 'Nattens hastighet', 'Night speed', rate],
	['CollectionDropRate', 'world', 'Resurser från insamling', 'Gathering yield', rate],
	['CollectionObjectHpRate', 'world', 'HP på träd och sten', 'HP of trees and rocks', rate],
	['CollectionObjectRespawnSpeedRate', 'world', 'Hur fort träd/sten kommer tillbaka (lägre = snabbare)', 'Tree/rock respawn time (lower = faster)', rate],
	['EnemyDropItemRate', 'world', 'Loot från fiender', 'Enemy loot', rate],
	['DropItemMaxNum', 'world', 'Max föremål på marken', 'Max items on the ground', { min: 0, max: 100000 }],
	['DropItemMaxNum_UNKO', 'world', 'Max bajs på marken', 'Max poop on the ground', { min: 0, max: 100000 }],
	['DropItemAliveMaxHours', 'world', 'Timmar innan föremål på marken försvinner', 'Hours before dropped items despawn', { type: 'float', min: 0, max: 240, step: 0.5 }],
	['PhysicsActiveDropItemMaxNum', 'world', 'Max föremål med fysik (-1 = obegränsat)', 'Max physics items (-1 = unlimited)', { min: -1, max: 100000 }],
	['bAllowEnemyCampSpawnNearBaseCamp', 'world', 'Fiendeläger får dyka upp nära baser', 'Enemy camps may spawn near bases'],

	// ---- baser och byggen
	['BaseCampMaxNum', 'base', 'Max antal baser på servern', 'Max bases on the server', { min: 1, max: 10000 }],
	['BaseCampWorkerMaxNum', 'base', 'Pals som jobbar per bas', 'Working pals per base', { min: 1, max: 50 }],
	['BaseCampMaxNumInGuild', 'base', 'Max baser per guild', 'Max bases per guild', { min: 1, max: 10 }],
	['BuildObjectHpRate', 'base', 'HP på byggen', 'Building HP', rate],
	['BuildObjectDamageRate', 'base', 'Skada på byggen', 'Damage to buildings', rate],
	['BuildObjectDeteriorationDamageRate', 'base', 'Förfall på byggen (0 = inget)', 'Building decay (0 = none)', rate],
	['bBuildAreaLimit', 'base', 'Begränsa var man får bygga (t.ex. nära torn)', 'Limit where you can build (e.g. near towers)'],
	['MaxBuildingLimitNum', 'base', 'Max byggdelar totalt (0 = obegränsat)', 'Max building pieces total (0 = unlimited)', { min: 0, max: 1000000 }],
	['MaxBuildingLimitNumPerPlayer', 'base', 'Max byggdelar per spelare (0 = obegränsat)', 'Max building pieces per player (0 = unlimited)', { min: 0, max: 1000000 }],
	['bInvisibleOtherGuildBaseCampAreaFX', 'base', 'Dölj andra guilds basgränser', 'Hide other guilds’ base borders'],
	['bEnableBuildingPlayerUIdDisplay', 'base', 'Visa vem som byggt', 'Show who built it'],
	['BuildingNameDisplayCacheTTLSeconds', 'base', 'Cache för byggnamn (sekunder)', 'Builder name cache (seconds)', { min: 0, max: 3600 }],

	// ---- guild
	['GuildPlayerMaxNum', 'guild', 'Max spelare per guild', 'Max players per guild', { min: 1, max: 100 }],
	['bAutoResetGuildNoOnlinePlayers', 'guild', 'Nollställ guild som ingen loggat in i', 'Reset guilds with no active players'],
	['AutoResetGuildTimeNoOnlinePlayers', 'guild', '…efter så många timmar', '…after this many hours', { type: 'float', min: 1, max: 10000, step: 1 }],
	['GuildRejoinCooldownMinutes', 'guild', 'Väntetid innan man går med i en guild igen (min)', 'Cooldown before rejoining a guild (min)', { min: 0, max: 100000 }],
	['AutoTransferMasterThresholdDays', 'guild', 'Dagar innan guildledarskap flyttas automatiskt', 'Days before guild master is transferred', { min: 0, max: 3650 }],
	['AutoTransferMasterCheckIntervalSeconds', 'guild', 'Hur ofta det kollas (sekunder)', 'Check interval (seconds)', { type: 'float', min: 60, max: 864000, step: 60 }],
	['MaxGuildsPerFrame', 'guild', 'Guilds som behandlas per frame', 'Guilds processed per frame', { min: 1, max: 1000 }],

	// ---- pvp
	['bIsPvP', 'pvp', 'PvP', 'PvP'],
	['bEnablePlayerToPlayerDamage', 'pvp', 'Spelare kan skada varandra', 'Players can damage each other'],
	['bEnableFriendlyFire', 'pvp', 'Friendly fire', 'Friendly fire'],
	['bEnableDefenseOtherGuildPlayer', 'pvp', 'Basförsvar attackerar andra guilds', 'Base defenses attack other guilds'],
	['DeathPenalty', 'pvp', 'När man dör tappar man', 'On death you drop', { type: 'select', options: [['None', 'Ingenting', 'Nothing'], ['Item', 'Föremål', 'Items'], ['ItemAndEquipment', 'Föremål och utrustning', 'Items and equipment'], ['All', 'Allt, även pals', 'Everything, including pals']] }],
	['bCanPickupOtherGuildDeathPenaltyDrop', 'pvp', 'Får plocka upp andra guilds döds-loot', 'May pick up other guilds’ death drops'],
	['bAdditionalDropItemWhenPlayerKillingInPvPMode', 'pvp', 'Extra loot när man dödar spelare i PvP', 'Extra drop when killing players in PvP'],
	['AdditionalDropItemWhenPlayerKillingInPvPMode', 'pvp', 'Föremål som droppas extra', 'Extra drop item'],
	['AdditionalDropItemNumWhenPlayerKillingInPvPMode', 'pvp', 'Antal extra', 'Extra drop amount', { min: 0, max: 1000 }],
	['bDisplayPvPItemNumOnWorldMap_BaseCamp', 'pvp', 'Visa PvP-föremål i baser på kartan', 'Show PvP items in bases on the map'],
	['bDisplayPvPItemNumOnWorldMap_Player', 'pvp', 'Visa PvP-föremål hos spelare på kartan', 'Show PvP items on players on the map'],

	// ---- chatt och röst
	['bIsShowJoinLeftMessage', 'chat', 'Visa när spelare går in/ut', 'Show join/leave messages'],
	['ChatPostLimitPerMinute', 'chat', 'Max chattmeddelanden per minut', 'Max chat messages per minute', { min: 1, max: 1000 }],
	['bEnableVoiceChat', 'chat', 'Röstchatt', 'Voice chat'],
	['VoiceChatMaxVolumeDistance', 'chat', 'Röst: avstånd för full volym', 'Voice: full volume distance', { type: 'float', min: 0, max: 100000, step: 100 }],
	['VoiceChatZeroVolumeDistance', 'chat', 'Röst: avstånd där det blir tyst', 'Voice: silent distance', { type: 'float', min: 0, max: 100000, step: 100 }],

	// ---- avancerat
	['AutoSaveSpan', 'advanced', 'Autosparning (sekunder)', 'Autosave (seconds)', { type: 'float', min: 10, max: 3600, step: 10 }],
	['bIsUseBackupSaveData', 'advanced', 'Spelets egna backuper av världen', 'The game’s own world backups'],
	['LogFormatType', 'advanced', 'Loggformat', 'Log format', { type: 'select', options: [['Text', 'Text', 'Text'], ['Json', 'JSON', 'JSON']] }],
	['ServerReplicatePawnCullDistance', 'advanced', 'Hur långt bort pals syns (cm)', 'How far away pals are synced (cm)', { type: 'float', min: 5000, max: 15000, step: 500, hint: ['Lägre = mindre belastning. 5000–15000.', 'Lower = less load. 5000–15000.'] }],
	['ItemContainerForceMarkDirtyInterval', 'advanced', 'Synk av kistor (sekunder)', 'Container sync (seconds)', { type: 'float', min: 0.1, max: 60, step: 0.1 }],
	['PlayerDataPalStorageUpdateCheckTickInterval', 'advanced', 'Synk av Palbox (sekunder)', 'Palbox sync (seconds)', { type: 'float', min: 0.1, max: 60, step: 0.1 }]
].map(([key, group, sv, en, extra = {}]) => ({ key, group, sv, en, ...extra }));

export const FIELD_BY_KEY = Object.fromEntries(PAL_FIELDS.map((f) => [f.key, f]));
