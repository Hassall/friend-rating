export const POINT_STEP = 5;
export const RATING_SECONDS = 120;

// Keep the original IDs for games that already picked their traits.
const ORIGINAL_TRAITS = [
  ["Big Brain", "Always has a theory", "✧"],
  ["Capper", "The truth is flexible", "♧"],
  ["Chaotic", "Brings unpredictable energy", "ϟ"],
  ["Clutch", "Comes through under pressure", "✦"],
  ["Comedian", "Commits to the bit", "☺"],
  ["Competitive", "Everything has a scoreboard", "⚑"],
  ["Crazy", "Takes the bit way further", "⚡"],
  ["Debater", "Has a counterpoint ready", "↔"],
  ["Drama Magnet", "Always in the middle of it", "✴"],
  ["Funny", "Makes people laugh", "☻"],
  ["Gamer", "Always down for one more", "✚"],
  ["Good Listener", "Remembers what you said", "◖"],
  ["Helpful", "Shows up when it counts", "✿"],
  ["Hype Friend", "Your loudest supporter", "▲"],
  ["Instigator", "Starts it for the plot", "✶"],
  ["Lore Keeper", "Remembers every inside joke", "▤"],
  ["Lurker", "Listening the whole time", "◉"],
  ["Meme Dealer", "Has the perfect reaction image", "▧"],
  ["Night Owl", "Still in voice at 3 AM", "☾"],
  ["Peacemaker", "Helps people find common ground", "☮"],
  ["Roaster", "Has a comeback for everything", "♨"],
  ["Side Quester", "Gets distracted with purpose", "◇"],
  ["Storyteller", "Every story has a side story", "☄"],
  ["Wholesome", "Makes the call feel like home", "♡"],
  ["Yapper", "Never runs out of things to say", "✺"],
  ["Backseat Gamer", "Has notes for whoever’s playing", "⌖"],
  ["Clip Archivist", "Always has the clip saved", "▣"],
  ["Group Chat DJ", "Has a track for every mood", "♫"],
  ["MVP", "Makes the whole squad better", "★"],
  ["Plot Twister", "Takes the conversation somewhere unexpected", "↷"],
  ["Pun Machine", "Can’t resist a terrible pun", "✹"],
  ["Quiet Carry", "Does the work without making a fuss", "◆"],
  ["Voice Actor", "Has a voice for every character", "◈"],
];

const BROAD_TRAITS = [
  ["Adventurous", "Up for trying something new", "↗"],
  ["Calm Under Pressure", "Keeps a cool head when things get tense", "◇"],
  ["Chill", "Easygoing and relaxed", "☾"],
  ["Confident", "Comfortable taking the lead", "▲"],
  ["Creative", "Comes up with original ideas", "✧"],
  ["Curious", "Asks questions and likes to learn", "?"],
  ["Dependable", "Follows through on what they promise", "✓"],
  ["Energetic", "Brings energy to the group", "ϟ"],
  ["Generous", "Shares their time or what they have", "✿"],
  ["Honest", "Tells you what they really think", "↔"],
  ["Kind", "Treats people with care", "♡"],
  ["Observant", "Notices details others miss", "◉"],
  ["Optimistic", "Finds a reason to stay hopeful", "☀"],
  ["Outgoing", "Starts conversations and brings people in", "✺"],
  ["Patient", "Gives people time to figure things out", "◷"],
  ["Playful", "Makes ordinary moments more fun", "☺"],
  ["Spontaneous", "Happy to make plans on the fly", "☄"],
  ["Supportive", "Encourages friends when they need it", "✦"],
  ["Thoughtful", "Remembers what matters to other people", "◆"],
];

const RETAINED_TRAITS = new Set(["Chaotic", "Competitive", "Funny", "Good Listener", "Helpful", "Peacemaker", "Storyteller"]);
export const TRAITS = [...ORIGINAL_TRAITS, ...BROAD_TRAITS];
export const LEGACY_TRAIT_IDS = ORIGINAL_TRAITS.map((_, id) => id);
export const TRAIT_IDS = TRAITS.map((_, id) => id)
  .filter((id) => id >= ORIGINAL_TRAITS.length || RETAINED_TRAITS.has(TRAITS[id][0]));
