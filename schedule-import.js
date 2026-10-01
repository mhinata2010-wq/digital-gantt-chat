const HEADER_ALIASES={
  code:['工程記号','記号','code','id','no','番号'],trade:['工種','業種','trade'],name:['作業名','工程名','名称','task'],
  company:['担当会社','施工業者','業者','会社'],start:['開始日','着手日','start'],finish:['終了日','完了日','finish','end'],
  duration:['所要日数','日数','工期','duration'],predecessors:['先行','先行工程','前工程','dependencies','predecessor'],
  quantity:['数量','qty'],unit:['単位','unit'],dailyOutput:['1日量','日当り','歩掛','dailyoutput'],crewCount:['班数','crew'],peoplePerCrew:['人/班','人／班','班人数','peoplepercrew'],costThousands:['金額(千円)','金額（千円）','金額','cost'],
  building:['棟','棟・階','棟階','グループ'],floor:['階','階数'],x0:['x0','開始x'],x1:['x1','終了x'],y:['y','行y']
};

const clean=value=>String(value??'').normalize('NFKC').trim();
const normalized=value=>clean(value).toLowerCase().replace(/[\s_・\/（）()：:.-]/g,'');

function csvLine(line,delimiter){
  const cells=[];let value='',quoted=false;
  for(let index=0;index<line.length;index++){
    const char=line[index];
    if(char==='"'&&quoted&&line[index+1]==='"'){value+='"';index++;continue}
    if(char==='"'){quoted=!quoted;continue}
    if(char===delimiter&&!quoted){cells.push(value);value='';continue}
    value+=char;
  }
  cells.push(value);return cells;
}

export function parseDelimited(text){
  const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length)return [];
  const delimiter=lines[0].includes('\t')?'\t':',';
  return lines.map(line=>csvLine(line,delimiter));
}

function headerMap(row){
  const map={};
  row.forEach((value,index)=>{
    const key=normalized(value);
    for(const [field,aliases] of Object.entries(HEADER_ALIASES))if(aliases.some(alias=>normalized(alias)===key)){map[field]=index;break}
  });
  return map;
}

function excelDate(value){
  if(value instanceof Date&&!Number.isNaN(value.valueOf()))return value.toISOString().slice(0,10);
  const text=clean(value);
  if(!text)return '';
  if(/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}$/.test(text)){const [year,month,day]=text.split(/[-\/.]/).map(Number);return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`}
  if(/^\d{1,2}[-\/.]\d{1,2}$/.test(text)){const [month,day]=text.split(/[-\/.]/).map(Number),year=new Date().getFullYear();return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`}
  const serial=Number(value);
  if(Number.isFinite(serial)&&serial>20000&&serial<90000){const date=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);return date.toISOString().slice(0,10)}
  return '';
}

function inclusiveDays(start,finish){
  if(!start||!finish)return 0;return Math.max(1,Math.round((new Date(`${finish}T12:00:00`)-new Date(`${start}T12:00:00`))/86400000)+1);
}

function refs(value){return clean(value).split(/[、,;／/\s]+/).map(clean).filter(Boolean)}

export function rowsFromMatrix(matrix,{sheetName=''}={}){
  const headerIndex=matrix.findIndex(row=>{const map=headerMap(row||[]);return map.name!==undefined&&(map.start!==undefined||map.duration!==undefined)});
  if(headerIndex<0)return {rows:[],issues:[`${sheetName||'選択シート'}に「作業名」と「開始日／所要日数」の見出しが見つかりません。03作業リストか読取結果TSVを選んでください。`]};
  const map=headerMap(matrix[headerIndex]);
  const rows=matrix.slice(headerIndex+1).map((row,index)=>({
    sourceRow:headerIndex+index+2,code:clean(row[map.code]),trade:clean(row[map.trade]),name:clean(row[map.name]),company:clean(row[map.company]),
    start:excelDate(row[map.start]),finish:excelDate(row[map.finish]),duration:Number(row[map.duration])||0,
    predecessorRefs:refs(row[map.predecessors]),building:clean(row[map.building]),floor:clean(row[map.floor]),quantity:clean(row[map.quantity]),unit:clean(row[map.unit]),dailyOutput:clean(row[map.dailyOutput]),crewCount:clean(row[map.crewCount]),peoplePerCrew:clean(row[map.peoplePerCrew]),costThousands:clean(row[map.costThousands]),
    x0:map.x0===undefined?'':clean(row[map.x0]),x1:map.x1===undefined?'':clean(row[map.x1]),y:map.y===undefined?'':clean(row[map.y])
  })).filter(row=>row.name||row.start||row.finish);
  return {rows,issues:[]};
}

export function buildImportCandidates(matrix,options={}){
  const parsed=rowsFromMatrix(matrix,options),existingCodes=new Set((options.existingTasks||[]).map(task=>clean(task.code).toUpperCase()));
  const rows=parsed.rows.map((row,index)=>({...row,code:(row.code||alphaCode(index)).toUpperCase()}));
  const codeByOrdinal=new Map(rows.map((row,index)=>[String(index+1),row.code]));
  const allCodes=new Set(rows.map(row=>row.code));
  const seen=new Set();
  const candidates=rows.map(row=>{
    const issues=[];let building=row.building;
    if(!row.name)issues.push('作業名がありません');
    if(seen.has(row.code)||existingCodes.has(row.code))issues.push(`工程記号 ${row.code} が重複しています`);seen.add(row.code);
    const coordinateInBuilding=/^-?\d+(\.\d+)?$/.test(building)&&Number(building)>20;
    if(coordinateInBuilding){issues.push('読取座標が「棟・階」に入った可能性があります');building=''}
    const predecessorCodes=row.predecessorRefs.map(ref=>codeByOrdinal.get(ref)||ref.toUpperCase()).filter(code=>{
      if(code===row.code){issues.push('自分自身を前工程にはできません');return false}
      if(!allCodes.has(code)&&!existingCodes.has(code)){issues.push(`前工程 ${code} が見つかりません`);return false}
      return true;
    });
    const calculated=Number(row.quantity)>0&&Number(row.dailyOutput)>0?Math.ceil(Number(row.quantity)/(Number(row.dailyOutput)*Math.max(1,Number(row.crewCount)||1))):0;
    const duration=Math.round(row.duration)||inclusiveDays(row.start,row.finish)||calculated;
    if(duration<1||duration>365)issues.push('所要日数を1〜365日で確認してください');
    if(row.start&&row.finish&&row.finish<row.start)issues.push('終了日が開始日より前です');
    return {...row,building,duration,predecessorCodes:[...new Set(predecessorCodes)],issues,accepted:issues.length===0};
  });
  return {candidates,issues:parsed.issues};
}

export function toImportRows(candidates){
  return candidates.filter(row=>row.accepted).map((row,index)=>({
    code:row.code,trade:row.trade,name:row.name,company:row.company,duration_days:row.duration,
    predecessor_codes:row.predecessorCodes,position:index,start_date:row.start||null,finish_date:row.finish||null,
    source_row:row.sourceRow,building:row.building||'',floor:row.floor||'',quantity:row.quantity||null,unit:row.unit||'',daily_output:row.dailyOutput||null,crew_count:row.crewCount||null,people_per_crew:row.peoplePerCrew||null,cost_thousands:row.costThousands||null,coordinates:{x0:row.x0||null,x1:row.x1||null,y:row.y||null}
  }));
}

function alphaCode(index){let value=index+1,code='';while(value){value--;code=String.fromCharCode(65+value%26)+code;value=Math.floor(value/26)}return code}
