import assert from 'node:assert/strict';
import {calculateDiscount,formatPromoPeriod} from '../public/src/pricing.js';
import {calculateWorktopOrder} from '../public/src/worktop-order.js';
for(const [target,saving] of [['furniture',1144],['worktop',750],['all',1894]])assert.equal(calculateDiscount(11440,7500,{active:true,target,percent:10}).saving,saving);
assert.equal(calculateDiscount(2860,0,{active:true,target:'all',percent:15}).total,2431);
assert.equal(calculateDiscount(0,0,{active:true,target:'all',percent:100}).total,0);
assert.equal(calculateDiscount(2860,0,{active:false,target:'all',percent:15}).total,2860);
assert.equal(calculateWorktopOrder([{length:618,joints:[]}],[{length:1000,price:3500},{length:1500,price:5000}]).cost,3500);
console.log('7 pricing tests passed');
const ms=[{id:'a',category:'lower',price:3000},{id:'b',category:'upper720',price:2000},{id:'a',category:'lower',price:3000}];
assert.equal(calculateDiscount(8000,4500,{active:true,target:'category',scope:'lower',percent:15},ms).saving,900);
assert.equal(calculateDiscount(8000,4500,{active:true,target:'article',scope:'a',percent:10},ms).saving,600);
assert.equal(calculateDiscount(8000,4500,{active:true,target:'article',scope:'missing',percent:10},ms).saving,0);
console.log('3 additional scoped discount tests passed');

for(const [promo,expected] of [
  [{active:true,start:'2026-11-25',end:'2026-11-30'},'С 25.11.2026 по 30.11.2026'],
  [{active:true,start:'2026-11-25',end:''},'С 25.11.2026'],
  [{active:true,start:'',end:'2026-11-30'},'До 30.11.2026'],
  [{active:true,start:'',end:''},''],
  [{active:true},''],
  [{active:false,start:'2026-11-25',end:'2026-11-30'},''],
  [null,''],
  [{active:true,start:'invalid',end:'2027-01-01'},'До 01.01.2027']
])assert.equal(formatPromoPeriod(promo),expected);
console.log('8 promo period tests passed');
