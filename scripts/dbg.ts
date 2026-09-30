import { chooseDiscard, type BotView } from './src/game-engine/ai/bot';
import { normalShanten, countsFromFaces, acceptanceCount } from './src/game-engine/traditional/hand';
import { totalRisk } from './src/game-engine/ai/defense';
import { createRng } from './src/game-engine/tiles/rng';
import { faceIndex, type TileFace } from './src/game-engine/tiles/tiles';
const F=(s:TileFace['suit'],r:number):TileFace=>({suit:s,rank:r});
const man=(r:number)=>F('man',r), pin=(r:number)=>F('pin',r), sou=(r:number)=>F('sou',r), wind=(r:number)=>F('wind',r), dragon=(r:number)=>F('dragon',r);
const hand=[man(2),man(3),man(4),pin(2),pin(3),pin(4),sou(2),sou(3),sou(4),man(5),man(9),man(9),wind(2),wind(2)];
const oppDiscards=[man(9),pin(1),pin(2),sou(1),wind(1),dragon(1),man(1),pin(9),sou(9),wind(3),wind(4),dragon(2),man(2),pin(5)];
const opponents=[{seat:1,discards:oppDiscards.map(f=>faceIndex(f)),meldCount:0,riichi:true}];
const view:BotView={seat:0,seatWind:1,roundWind:1,hand,melds:[],bonusFaces:[],visibleDiscards:oppDiscards,otherMeldFaces:[],wallCount:20,turnNumber:12,opponents};
const used = countsFromFaces([...oppDiscards, ...hand]);
for (let i=0;i<hand.length;i++){
  const rem=hand.filter((_,k)=>k!==i);
  const sh=normalShanten(countsFromFaces(rem),0);
  const acc=acceptanceCount(countsFromFaces(rem),0,used);
  const fi=faceIndex(hand[i]);
  console.log(i, hand[i].suit+hand[i].rank, 'sh',sh,'acc',acc,'risk',totalRisk(fi,opponents,used));
}
console.log('hard pick', chooseDiscard(view,'hard',createRng(7)));
