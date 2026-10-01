export function taskWeight(task){
  const cost=Number(task?.cost_thousands)||0;
  if(cost>0)return {value:cost,basis:'cost'};
  const labor=(Number(task?.duration_days)||0)*(Number(task?.crew_count)||0)*(Number(task?.people_per_crew)||0);
  if(labor>0)return {value:labor,basis:'labor'};
  return {value:Math.max(1,Number(task?.duration_days)||1),basis:'duration'};
}

export function weightedProgress(tasks,progressOf){
  let total=0,earned=0;const bases=new Set();
  for(const task of tasks||[]){const weight=taskWeight(task);total+=weight.value;earned+=weight.value*Math.max(0,Math.min(100,Number(progressOf(task))||0))/100;bases.add(weight.basis)}
  return {percent:total?Math.round(earned/total*100):0,total,basis:bases.size===1?[...bases][0]:'mixed'};
}

export function plannedProgressSeries(tasks,schedule){
  const totalWeight=(tasks||[]).reduce((sum,task)=>sum+taskWeight(task).value,0),total=Math.max(0,Number(schedule?.total)||0),points=[];
  for(let day=0;day<=total;day++){
    let earned=0;
    for(const task of tasks||[]){const node=schedule?.nodes?.get(task.id);if(!node)continue;const elapsed=Math.max(0,Math.min(Number(node.duration)||1,day-Number(node.es)));earned+=taskWeight(task).value*elapsed/Math.max(1,Number(node.duration)||1)}
    points.push({day,percent:totalWeight?Math.round(earned/totalWeight*1000)/10:0});
  }
  return points;
}
