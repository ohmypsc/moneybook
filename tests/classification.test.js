import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTags, normalizeRules, classifyTransaction } from '../shared/classification.js';
const categories=[{categoryId:'CAFE',type:'지출',active:true},{categoryId:'SHOP',type:'지출',active:true}];
const rules=normalizeRules([
 {id:'1',name:'카페',type:'지출',contains:'스타벅스',categoryId:'CAFE',tags:['여행']},
 {id:'2',name:'카드',type:'지출',accountId:'CARD',categoryId:'SHOP',tags:['가족','여행']}
]);
test('rule priority and AND conditions, tag union and disabled rules',()=>{
 const tx={type:'지출',description:'스타벅스 제주',paymentMethodId:'CARD',categorySource:'auto'};
 assert.deepEqual(classifyTransaction(tx,rules,categories),{categoryId:'CAFE',categorySource:'auto',tags:['여행','가족'],matchedNames:['카페','카드']});
 assert.equal(classifyTransaction(tx,[{...rules[0],accountId:'OTHER'}],categories).categoryId,'');
 assert.deepEqual(classifyTransaction(tx,rules.map(r=>({...r,enabled:false})),categories).tags,[]);
 assert.equal(classifyTransaction({...tx,type:'수입'},rules,categories).categoryId,'');
});
test('manual category is preserved while tags are added; inactive category skipped',()=>{
 const tx={type:'지출',description:'스타벅스',categoryId:'SHOP',categorySource:'manual'};
 assert.equal(classifyTransaction(tx,rules,categories).categoryId,'SHOP');
 assert.deepEqual(classifyTransaction(tx,rules,categories).tags,['여행']);
 assert.equal(classifyTransaction({...tx,categorySource:'auto'},rules,[{...categories[0],active:false}]).categoryId,'SHOP');
});
test('tag normalization, limits and malformed rules',()=>{
 assert.deepEqual(normalizeTags(' #여행, 여행, Family, family '),['여행','Family']);
 assert.throws(()=>normalizeTags(['가'.repeat(31)]));assert.throws(()=>normalizeTags(Array.from({length:11},(_,i)=>String(i))));
 assert.throws(()=>normalizeRules([{...rules[0],contains:'',accountId:''}]));
 assert.throws(()=>normalizeRules([rules[0],rules[0]]));
 assert.throws(()=>normalizeRules([{...rules[0],categoryId:'',tags:[]}]));
 const userTags=Array.from({length:10},(_,i)=>String(i));
 assert.deepEqual(classifyTransaction({type:'지출',description:'스타벅스',tags:userTags},rules,categories).tags,userTags);
});
