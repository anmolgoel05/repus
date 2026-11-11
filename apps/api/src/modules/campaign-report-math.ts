export function percentageOfAccepted(count:number,accepted:number){
 return accepted>0?Math.round(count/accepted*1000)/10:null;
}
