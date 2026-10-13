// Anonymous demo scores only. A dedicated repository-scoped token stays on the server.
const REPO='s-tamerlan96/five-letters-game-center';
const BRANCH='leaderboards';
const MAX_ROWS=1000;
const headers=()=>({'Accept':'application/vnd.github+json','Authorization':'Bearer '+process.env.GITHUB_LEADERBOARD_TOKEN,'X-GitHub-Api-Version':'2022-11-28'});
const dayKey=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
function validDay(day){const date=new Date(day+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(day||'')&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day;}
function validate(body,now=Date.now()){
 if(!body||typeof body!=='object'||JSON.stringify(body).length>2048)return 'Некорректный результат';
 const {day,playerId,runId,score,nickname}=body;
 if(!validDay(day)||![dayKey(now),dayKey(now-86400000)].includes(day))return 'День уже закрыт';
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(playerId||'')||!/^[a-zA-Z0-9_-]{16,80}$/.test(runId||''))return 'Некорректный идентификатор';
 if(!Number.isInteger(score)||score<0||score>24)return 'Некорректный счёт';
 if(typeof nickname!=='string'||nickname!==nickname.trim()||!/^[-\p{L}\p{N}_ .]{2,20}$/u.test(nickname))return 'Ник: 2–20 букв, цифр, пробелов или знаков . _ -';
 return null;
}
function rankRows(rows){return [...rows].sort((a,b)=>b.score-a.score||a.at-b.at||a.playerId.localeCompare(b.playerId));}
async function readBoard(day,transport=fetch){
 const r=await transport(`https://api.github.com/repos/${REPO}/contents/results/${day}.json?ref=${BRANCH}`,{headers:headers(),signal:AbortSignal.timeout(8000)});
 if(r.status===404)return {rows:[],sha:null};
 if(!r.ok)throw Error('GitHub read '+r.status);
 const json=await r.json(),data=JSON.parse(Buffer.from(json.content,'base64').toString('utf8'));
 if(!Array.isArray(data.rows))throw Error('Invalid board');return {rows:data.rows,sha:json.sha};
}
async function saveScore(body,transport=fetch,now=Date.now()){
 for(let retry=0;retry<4;retry++){
  const board=await readBoard(body.day,transport),prior=board.rows.find(x=>x.playerId===body.playerId);
  if(prior){if(prior.runId!==body.runId) return {status:409,error:'За этот день результат уже записан'};return {status:200,rows:rankRows(board.rows),entry:prior};}
  if(board.rows.length>=MAX_ROWS)return {status:409,error:'Таблица этого дня заполнена'};
  const entry={playerId:body.playerId,runId:body.runId,nickname:body.nickname,score:body.score,at:now};board.rows.push(entry);
  const payload={message:'Record daily chain result '+body.day,branch:BRANCH,content:Buffer.from(JSON.stringify({day:body.day,rows:board.rows})).toString('base64')};if(board.sha)payload.sha=board.sha;
  const r=await transport(`https://api.github.com/repos/${REPO}/contents/results/${body.day}.json`,{method:'PUT',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
  if(r.ok)return {status:200,rows:rankRows(board.rows),entry};
  if(![409,422].includes(r.status))throw Error('GitHub write '+r.status);
 }
 return {status:503,error:'Таблица обновляется. Попробуй ещё раз'};
}
async function handler(req,res){
 const origins=new Set(['https://s-tamerlan96.github.io',...(process.env.LEADERBOARD_ALLOWED_ORIGINS||'').split(',').filter(Boolean)]),origin=req.headers.origin;
 res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');
 if(origin&&!origins.has(origin))return res.status(403).json({error:'Недоступный источник'});
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Метод недоступен'});
 if(!process.env.GITHUB_LEADERBOARD_TOKEN)return res.status(req.method==='GET'?200:503).json({configured:false,error:'Общая таблица ещё не подключена',code:'NOT_CONFIGURED'});
 try{
  if(req.method==='GET'){
   const day=req.query?.day||dayKey();if(!validDay(day))return res.status(400).json({error:'Некорректная дата'});
   const board=await readBoard(day);return res.status(200).json({configured:true,day,rows:rankRows(board.rows),closed:day<dayKey()});
  }
  let body=req.body;if(typeof body==='string'){if(body.length>2048)return res.status(413).json({error:'Слишком большой запрос'});body=JSON.parse(body);}
  const error=validate(body);if(error)return res.status(400).json({error});
  const result=await saveScore(body);return res.status(result.status).json(result);
 }catch(error){return res.status(503).json({error:'Не удалось обновить общую таблицу. Результат остаётся на устройстве'});}
}
module.exports=handler;module.exports.validate=validate;module.exports.rankRows=rankRows;module.exports.saveScore=saveScore;module.exports.dayKey=dayKey;
