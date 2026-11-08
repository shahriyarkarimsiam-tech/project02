/** Public theme descriptions. Prices are enforced independently in D1. */
export const THEMES = Object.freeze([
  { id: 'mint', name: 'Neo Mint', cost: 0, note: 'The original arcade look' },
  { id: 'aurora', name: 'Aurora', cost: 25, note: 'Electric violet and teal' },
  { id: 'sunset', name: 'Solar Flare', cost: 60, note: 'Warm coral and gold' },
  { id: 'midnight', name: 'Midnight', cost: 100, note: 'Icy blue night mode' }
]);
export function earnedBadges({ gamesPlayed=0, bestScore=0, bestTile=0, streak=0 } = {}) {
  return [
    { id:'first', title:'First Steps', desc:'Finish your first run', unlocked:gamesPlayed >= 1, mark:'✦' },
    { id:'five', title:'Habit Builder', desc:'Finish 5 games', unlocked:gamesPlayed >= 5, mark:'◈' },
    { id:'high', title:'Score Hunter', desc:'Reach 2,048 points', unlocked:bestScore >= 2048, mark:'★' },
    { id:'tile', title:'Tile Master', desc:'Make a 512 tile', unlocked:bestTile >= 512, mark:'◆' },
    { id:'streak', title:'On a Roll', desc:'Play on 3 consecutive UTC days', unlocked:streak >= 3, mark:'⚡' },
    { id:'legend', title:'Beyond 2048', desc:'Make a 2,048 tile', unlocked:bestTile >= 2048, mark:'✺' }
  ];
}
