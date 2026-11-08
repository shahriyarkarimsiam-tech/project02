import { newGame, move, replay, coinsForScore } from './engine.mjs';
import { THEMES, earnedBadges } from './catalog.mjs';

const $ = id => document.getElementById(id);
const tg = window.Telegram?.WebApp;
const dateUTC = () => new Date().toISOString().slice(0, 10);
const stamp = () => Math.floor(Date.now()/1000);
const num = n => Number(n||0).toLocaleString('en-US');
const names = { home:'Overview', play:'Play game', challenges:'Challenges', rankings:'Rankings', shop:'Theme shop', profile:'My profile' };
const ranks = [{at:0,title:'Rookie explorer'},{at:1,title:'Bronze merger'},{at:5,title:'Silver strategist'},{at:15,title:'Golden master'},{at:40,title:'Diamond legend'}];
const emptyPlayer = () => ({id:'demo',name:'Guest player',coins:0,bestScore:0,bestTile:0,gamesPlayed:0,streak:0,equippedTheme:'mint',ownedThemes:['mint']});
let player=emptyPlayer(), online=false, view='home', rankMode='classic', currentMode='classic';
let state=null, moves=[], currentRun=null, completed=false, busy=false, toastTimer, leaderCache={classic:[],daily:[]};
let activeRuns=[], recentGames=[], daily={date:dateUTC(),started:false,completed:false,score:null};

function read(key, fallback=null){ try { return JSON.parse(localStorage.getItem(key))??fallback; } catch { return fallback; } }
function write(key,val){ try { localStorage.setItem(key,JSON.stringify(val)); } catch {} }
function erase(key){ try { localStorage.removeItem(key); } catch {} }
function toast(message){ $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,3300); }
async function api(path, options={}) {
  const response=await fetch(`/api${path}`,{method:options.method||'GET',credentials:'same-origin',headers:options.body?{'content-type':'application/json'}:{},body:options.body?JSON.stringify(options.body):undefined});
  let result={}; try { result=await response.json(); } catch {}
  if(!response.ok) throw new Error(result.error||`Request failed (${response.status})`);
  return result;
}
function clear(node){ node.replaceChildren(); }
function el(tag, className='', text=''){ const item=document.createElement(tag); if(className) item.className=className; if(text!==undefined && text!==null) item.textContent=String(text); return item; }
function seededGuestDaily(day){ let h=2166136261; for(const c of `merge-streak-guest-${day}`){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0; }
function localStreak(){ const days=new Set(recentGames.map(g=>new Date(g.finishedAt*1000).toISOString().slice(0,10))); let day=new Date(`${dateUTC()}T00:00:00Z`); if(!days.has(dateUTC()))day=new Date(day.getTime()-86400000);let count=0;while(days.has(day.toISOString().slice(0,10))){count++;day=new Date(day.getTime()-86400000);if(count>=365)break;}return count; }
function refreshGuestDaily(){ const day=dateUTC(); if(daily.date!==day) { daily={date:day,started:false,completed:false,score:null};write('ms_demo_daily',daily); } }
function draftKey(run){ return online?`ms_run_${player.id}_${run.id}`:`ms_demo_run_${run.mode}`; }
function saveDraft(){ if(!currentRun||completed)return;write(draftKey(currentRun),{seed:currentRun.seed,moves,mode:currentRun.mode,challengeDay:currentRun.challengeDay,id:currentRun.id}); }
function storeGuest(){ if(online)return;player.streak=localStreak();write('ms_demo_player_v2',player);write('ms_demo_recent',recentGames);write('ms_demo_daily',daily); }
function avatar(){ return (player.name||'G').trim().charAt(0).toUpperCase()||'G'; }
function setView(next){
  if(!names[next])return;
  view=next;
  document.querySelectorAll('[data-view]').forEach(node=>node.classList.toggle('active',node.dataset.view===next));
  document.querySelectorAll('[data-view-target]').forEach(node=>{node.classList.toggle('active',node.dataset.viewTarget===next);if(node.classList.contains('nav-button'))node.setAttribute('aria-current',node.dataset.viewTarget===next?'page':'false');});
  $('page-crumb').textContent=names[next];
  if(next==='rankings')refreshLeaderboard();
  if(next==='shop')renderShop();
  if(next==='challenges')renderBadges();
  if(next==='profile')renderProfilePage();
  window.scrollTo?.({top:0,behavior:'instant'});
}
function updateRank(){
  const n=Number(player.gamesPlayed||0);let current=ranks[0], next=null;
  for(let i=0;i<ranks.length;i++)if(n>=ranks[i].at){current=ranks[i];next=ranks[i+1]||null;}
  $('rank-title').textContent=current.title;
  $('rank-progress').textContent=next?`${num(n)} / ${num(next.at)} games`:'MAX RANK';
  const percent=next?Math.min(100,(n-current.at)/(next.at-current.at)*100):100;
  $('progress-fill').style.width=`${percent}%`;
}
function updateDailyUI(){
  if(!online)refreshGuestDaily();
  $('daily-home-tag').textContent=daily.completed?'COMPLETED':daily.started?'IN PROGRESS':'NOT STARTED';
  $('daily-home-btn').textContent=daily.completed?'View today’s scores ↗':daily.started?'Continue challenge ↗':'Play daily puzzle ↗';
  $('challenge-go').textContent=daily.completed?'See daily leaderboard ↗':daily.started?'Resume daily run ↗':'Start daily challenge ↗';
  $('challenge-day-caption').textContent=daily.completed?`Today's attempt saved with ${num(daily.score)} points. The next challenge opens at 00:00 UTC.`:'Play today’s seeded challenge. One completed entry per day; your score is compared with Telegram players.';
  $('daily-day-label').textContent=`${daily.date} · Reset at 00:00 UTC`;
}
function renderProfileBase(){
  $('coin-count').textContent=num(player.coins);
  $('shop-balance').textContent=num(player.coins);
  $('profile-avatar').textContent=avatar();
  $('player-avatar').textContent=avatar();
  $('profile-big-avatar').textContent=avatar();
  $('player-name').textContent=player.name;
  $('profile-display-name').textContent=player.name;
  $('welcome-name').textContent=player.name.split(' ')[0]||'player';
  $('connection-status').textContent=online?'Verified Telegram player':'Local practice mode';
  $('profile-login-status').textContent=online?'Your scores and unlocked themes are stored in the game database.':'Practice progress stays on this device; it does not appear in online rankings.';
  $('mode-label').textContent=online?'TELEGRAM CONNECTED':'PRACTICE MODE';
  $('home-best').textContent=num(Math.max(player.bestScore,state?.score||0));
  $('home-games').textContent=num(player.gamesPlayed);
  $('home-streak').textContent=num(player.streak);
  $('home-tile').textContent=num(player.bestTile);
  $('best-score').textContent=num(Math.max(player.bestScore,state?.score||0));
  $('profile-best').textContent=num(player.bestScore);
  $('profile-games').textContent=num(player.gamesPlayed);
  $('profile-tile').textContent=num(player.bestTile);
  $('profile-streak').textContent=num(player.streak);
  updateRank(); updateDailyUI();
}
function renderRecent(containerId){
  const target=$(containerId); clear(target);
  if(!recentGames.length){target.appendChild(el('div','empty-state','No saved games yet. Play and finish your first run!'));return;}
  for(const game of recentGames.slice(0,5)){
    const row=el('div','recent-item'), icon=el('span','recent-icon',game.mode==='daily'?'⚡':'◈'),detail=el('div'),label=el('strong','',game.mode==='daily'?'Daily challenge':'Classic run');
    const dt=new Date(game.finishedAt*1000).toLocaleDateString('en-GB',{month:'short',day:'numeric'});
    detail.append(label,el('small','',`${dt} · Completed`));row.append(icon,detail,el('b','',num(game.score)));target.append(row);
  }
}
function renderBadges(){
  const badges=earnedBadges(player),target=$('badges-list');clear(target);
  $('badge-count').textContent=`${badges.filter(b=>b.unlocked).length} / ${badges.length} unlocked`;
  for(const badge of badges){
    const card=el('div',`badge-card ${badge.unlocked?'unlocked':'locked'}`);
    card.append(el('div','badge-graphic',badge.mark),el('strong','',badge.title),el('p','',badge.desc),el('span','badge-state',badge.unlocked?'✓ UNLOCKED':'LOCKED'));
    target.append(card);
  }
}
function renderProfilePage(){
  renderProfileBase();renderRecent('profile-recent');clear($('profile-badges'));
  const achieved=earnedBadges(player).filter(b=>b.unlocked);
  if(!achieved.length) $('profile-badges').append(el('p','muted-paragraph','Your first badge unlocks after saving a run.'));
  for(const badge of achieved)$('profile-badges').append(el('span','',`${badge.mark} ${badge.title}`));
}
function renderDashboard(){ renderProfileBase(); renderRecent('home-recent'); renderBadges();renderProfilePage(); }
function applyTheme(id){
  document.body.dataset.theme=THEMES.some(t=>t.id===id)?id:'mint';
  const safe=THEMES.some(t=>t.id===id)?id:'mint';
  player.equippedTheme=safe;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',safe==='sunset'?'#130e1a':'#090e1a');
}
function renderShop(){
  const target=$('theme-list'); clear(target);
  for(const theme of THEMES){
    const owned=theme.cost===0||player.ownedThemes.includes(theme.id);
    const equipped=player.equippedTheme===theme.id;
    const card=el('article','theme-card'), preview=el('div',`theme-preview ${theme.id}`), body=el('div','theme-card-body'),heading=el('h3','',theme.name),description=el('p','',theme.note),foot=el('div','theme-card-footer');
    for(const n of [2,8,32])preview.append(el('span','',n));
    const price=el('span',`theme-price ${theme.cost===0?'free':''}`,theme.cost===0?'FREE':`✦ ${theme.cost}`);
    const button=el('button',`btn ${equipped?'btn-disabled':owned?'btn-primary':'btn-outline'}`,equipped?'✓ Equipped':owned?'Use theme':'Unlock theme');
    button.disabled=equipped;
    button.addEventListener('click',()=>owned?equipTheme(theme.id):buyTheme(theme.id));
    foot.append(price,button);body.append(heading,description,foot);card.append(preview,body);target.append(card);
  }
}
async function buyTheme(id){
  const theme=THEMES.find(x=>x.id===id);if(!theme||theme.cost===0)return;
  if(player.coins<theme.cost){toast(`You need ${num(theme.cost-player.coins)} more virtual coins.`);return;}
  if(busy)return;
  if(!confirm(`Unlock ${theme.name} for ${theme.cost} virtual coins?`))return;
  busy=true;
  try{
    if(online){const result=await api('/shop/buy',{method:'POST',body:{themeId:id}});player.coins=result.coins;}
    else player.coins-=theme.cost;
    player.ownedThemes.push(id);storeGuest();renderDashboard();renderShop();toast(`${theme.name} unlocked. You can equip it now.`);
  }catch(err){toast(err.message);}finally{busy=false;}
}
async function equipTheme(id){
  if(!player.ownedThemes.includes(id))return;
  if(busy)return;busy=true;
  try{
    if(online)await api('/shop/equip',{method:'POST',body:{themeId:id}});
    applyTheme(id);storeGuest();renderShop();toast('Theme equipped!');
  }catch(err){toast(err.message);}finally{busy=false;}
}
function renderBoard(){
  if(!state)return;
  const board=$('game-board'),nodes=document.createDocumentFragment();
  state.board.forEach((value,index)=>{const node=el('div',`tile${value>2048?' high':''}`,value?String(value):'');node.dataset.value=String(value);node.setAttribute('role','gridcell');node.setAttribute('aria-label',`Row ${Math.floor(index/4)+1}, column ${index%4+1}: ${value||'empty'}`);nodes.append(node);});
  board.replaceChildren(nodes);
  $('score').textContent=num(state.score);$('move-count').textContent=num(state.moves);
  $('largest-tile').textContent=`TOP TILE · ${num(Math.max(...state.board))}`;
  $('bank-btn').disabled=busy||completed||moves.length<2;
  $('new-game-btn').disabled=busy||currentMode==='daily';
  $('run-mode-heading').textContent=currentMode==='daily'?`DAILY CHALLENGE · ${daily.date}`:'CLASSIC MODE';
  $('run-title').textContent=currentMode==='daily'?'One chance today':'Your next high score';
  $('game-state-chip').textContent=completed?'SCORE SAVED':state.over?'BOARD FULL':currentMode==='daily'?'DAILY IN PROGRESS':'KEEP MERGING';
  document.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('active',button.dataset.mode===currentMode));
  renderProfileBase();
}
function setStatus(message){$('game-status').textContent=message;}
function localSeed(){const arr=new Uint32Array(1);crypto.getRandomValues(arr);return arr[0];}
function hydrateRun(run,history){
  currentMode=run.mode||'classic';currentRun={...run,mode:currentMode};moves=Array.isArray(history)?history:[];
  try{state=replay(run.seed,moves);}catch{moves=[];state=newGame(run.seed);}
  completed=false;saveDraft();renderBoard();setStatus(currentMode==='daily'?'Daily challenge: this is your only scored attempt today.':'Swipe the tiles to improve your best.');
}
async function launch(mode='classic',newRun=false){
  if(busy)return;
  if(mode==='daily' && daily.date!==dateUTC()) {
    if(online){try{const updated=await api('/me');daily=updated.daily;activeRuns=updated.activeRuns||[];}catch{toast('Could not refresh the daily challenge.');return;}}
    else refreshGuestDaily();
  }
  if(mode==='daily'){
    if(daily.completed){rankMode='daily';setView('rankings');document.querySelectorAll('[data-rank-mode]').forEach(b=>b.classList.toggle('active',b.dataset.rankMode==='daily'));refreshLeaderboard();return;}
  }
  if(!newRun && currentRun && !completed && currentMode===mode && (mode!=='daily'||currentRun.challengeDay===dateUTC())){setView('play');return;}
  if(newRun && mode==='daily'){toast('Daily mode allows only one entry per UTC day.');return;}
  if(!newRun && !online){
    const draft=read(`ms_demo_run_${mode}`);
    if(draft && Number.isInteger(draft.seed) && (mode!=='daily'||draft.challengeDay===dateUTC())){hydrateRun(draft,draft.moves);setView('play');return;}
  }
  if(!newRun && online){
    const active=activeRuns.find(r=>r.mode===mode && (mode==='classic'||r.challengeDay===dateUTC()));
    if(active){const saved=read(`ms_run_${player.id}_${active.id}`,{});hydrateRun(active,saved.moves||[]);setView('play');return;}
  }
  if(newRun&&currentRun&&!completed&&currentMode===mode&&moves.length>0&&!confirm('Start a new run? Your unfinished score will be abandoned.'))return;
  busy=true;
  try{
    let run;
    if(online){run=await api('/game/start',{method:'POST',body:{mode}});activeRuns=activeRuns.filter(r=>r.mode!==mode);activeRuns.unshift(run);}
    else run={id:`guest-${mode}-${dateUTC()}`,mode,seed:mode==='daily'?seededGuestDaily(dateUTC()):localSeed(),challengeDay:mode==='daily'?dateUTC():null,startedAt:stamp()};
    if(mode==='daily'){daily.started=true;storeGuest();}
    const saved=read(draftKey(run),{});
    hydrateRun(run,run.reused?saved.moves||[]:[]);
    setView('play');
  }catch(err){toast(err.message);}finally{busy=false;renderBoard();}
}
async function completeGame(){
  if(!state||completed||busy||moves.length<2)return;
  busy=true;$('bank-btn').disabled=true;setStatus('Verifying and saving your score...');
  try{
    let earned,score=state.score;
    if(online){
      const result=await api('/game/finish',{method:'POST',body:{id:currentRun.id,moves}});
      earned=result.coinsAwarded;score=result.score;
      player.coins=result.coins;player.bestScore=result.bestScore;player.bestTile=result.bestTile;player.gamesPlayed=result.gamesPlayed;
      activeRuns=activeRuns.filter(run=>run.id!==currentRun.id);
    }else{
      const todayEarned=recentGames.filter(g=>new Date(g.finishedAt*1000).toISOString().slice(0,10)===dateUTC()).reduce((sum,g)=>sum+(g.coinsAwarded||0),0);
      earned=Math.min(coinsForScore(score),Math.max(0,60-todayEarned));
      player.coins+=earned;player.bestScore=Math.max(player.bestScore,score);player.bestTile=Math.max(player.bestTile,...state.board);player.gamesPlayed++;
    }
    erase(draftKey(currentRun));
    if(currentMode==='daily'){daily.started=true;daily.completed=true;daily.score=score;}
    recentGames.unshift({score,mode:currentMode,finishedAt:stamp(),coinsAwarded:earned});recentGames=recentGames.slice(0,45);
    player.streak=localStreak();
    storeGuest();completed=true;
    $('finish-title').textContent=state.over?'Board full!':'Score saved!';
    $('final-score').textContent=num(score);$('final-coins').textContent=`+${num(earned)}`;
    $('finish-caption').textContent=currentMode==='daily'?online?'Your daily score is recorded. Come back tomorrow for another challenge.':'Your practice daily score stays on this device.':online?'Your verified score counts toward the all-time rankings.':'Practice scores and coins stay on this device.';
    $('play-again-btn').textContent=currentMode==='daily'?'Play classic ↻':'Play again ↻';
    setStatus('Run saved. Keep playing to improve your best.');
    renderBoard();renderDashboard();renderShop();
    $('finish-dialog').showModal();
    if(online)refreshLeaderboard();
  }catch(err){setStatus('Saving failed. Your game is still stored on this device.');toast(err.message);}
  finally{busy=false;renderBoard();}
}
function takeTurn(direction){
  if(view!=='play'||!state||completed||busy||state.over)return;
  const result=move(state,direction);
  if(!result.changed){setStatus('That direction cannot move the tiles.');return;}
  state=result.state;moves.push(direction);saveDraft();renderBoard();
  try{tg?.HapticFeedback?.impactOccurred?.(result.gained?'medium':'light');}catch{}
  setStatus(result.gained?`Nice merge! +${result.gained} points`:'Keep the largest tile near a corner.');
  if(state.over||moves.length>=1400){setStatus('Run finished. Saving your score...');completeGame();}
}
function paintLeaders(list){
  const target=$('leaderboard');clear(target);
  if(!list.length){target.append(el('div','empty-state',online?'No completed scores yet. Be the first to post a result.':'Online rankings require published scores. Open the game in Telegram after deployment.'));return;}
  list.forEach((item,index)=>{
    const row=el('div','leader');row.append(el('span','leader-index',String(index+1).padStart(2,'0')),el('span','leader-portrait',String(item.name||'P')[0].toUpperCase()),el('span','leader-name',String(item.name||'Player').slice(0,40)),el('strong','leader-score',num(item.score)));target.append(row);
  });
}
async function refreshLeaderboard(){
  $('rank-date-note').textContent=rankMode==='daily'?`UTC challenge · ${dateUTC()}`:'Verified completed games only';
  try{const result=await api(`/leaderboard?mode=${rankMode}`);leaderCache[rankMode]=result.leaders||[];paintLeaders(leaderCache[rankMode]);}
  catch{paintLeaders(leaderCache[rankMode]||[]);}
}
async function authenticate(){
  if(!tg?.initData)return false;
  try{
    await api('/auth/telegram',{method:'POST',body:{initData:tg.initData}});
    const data=await api('/me');online=true;player={...emptyPlayer(),...data.player};
    activeRuns=data.activeRuns||[];recentGames=data.recentGames||[];daily=data.daily||daily;applyTheme(player.equippedTheme);
    return true;
  }catch{toast('Telegram sign-in unavailable. Practice mode is still playable.');return false;}
}
async function boot(){
  try{tg?.ready?.();tg?.expand?.();}catch{}
  $('today-label').textContent=new Date().toLocaleDateString('en-GB',{month:'short',day:'numeric',year:'numeric'}).toUpperCase();
  if(!(await authenticate())){
    player={...emptyPlayer(),...read('ms_demo_player_v2',{})};
    recentGames=read('ms_demo_recent',[]);daily=read('ms_demo_daily',daily);refreshGuestDaily();player.streak=localStreak();applyTheme(player.equippedTheme);
  }
  const active=online?activeRuns.find(run=>run.mode==='classic'):read('ms_demo_run_classic');
  if(active){const cache=online?read(`ms_run_${player.id}_${active.id}`,{}):active;hydrateRun(active,cache.moves||[]);}
  else if(!online){const run={id:'guest-classic',mode:'classic',seed:localSeed(),startedAt:stamp()};hydrateRun(run,[]);}
  else {currentMode='classic';setStatus('Choose Play classic to begin your first run.');}
  renderDashboard();renderShop();refreshLeaderboard();setView('home');
}

// UI routing
for(const button of document.querySelectorAll('[data-view-target]'))button.addEventListener('click',()=>setView(button.dataset.viewTarget));
for(const button of document.querySelectorAll('[data-launch-mode]'))button.addEventListener('click',()=>launch(button.dataset.launchMode));
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>launch(button.dataset.mode));
for(const button of document.querySelectorAll('[data-rank-mode]'))button.addEventListener('click',()=>{rankMode=button.dataset.rankMode;document.querySelectorAll('[data-rank-mode]').forEach(b=>b.classList.toggle('active',b.dataset.rankMode===rankMode));refreshLeaderboard();});
for(const button of document.querySelectorAll('[data-direction]'))button.addEventListener('click',()=>takeTurn(button.dataset.direction));
$('new-game-btn').addEventListener('click',()=>launch(currentMode,true));
$('bank-btn').addEventListener('click',()=>{
  if(currentMode==='daily'&&!confirm('Save your daily score now? This ends your only daily attempt.'))return;
  completeGame();
});
$('help-btn').addEventListener('click',()=>$('info-dialog').showModal());
$('refresh-leaders').addEventListener('click',refreshLeaderboard);
$('dismiss-finish-btn').addEventListener('click',()=>{$('finish-dialog').close();setView('home');});
$('play-again-btn').addEventListener('click',()=>{const mode=currentMode==='daily'?'classic':currentMode;$('finish-dialog').close();launch(mode,true);});
let swipe=null;const board=$('game-board');
board.addEventListener('pointerdown',e=>{swipe={x:e.clientX,y:e.clientY};});
board.addEventListener('pointerup',e=>{
  if(!swipe)return;const dx=e.clientX-swipe.x,dy=e.clientY-swipe.y;swipe=null;
  if(Math.max(Math.abs(dx),Math.abs(dy))<20)return;
  takeTurn(Math.abs(dx)>=Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');
});
board.addEventListener('pointercancel',()=>swipe=null);
document.addEventListener('keydown',e=>{
  if($('info-dialog').open||$('finish-dialog').open||view!=='play')return;
  const direction={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right'}[e.key];
  if(direction){e.preventDefault();takeTurn(direction);}
});
boot();
