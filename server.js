const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DB = path.join(DATA_DIR, 'data.json');
const UPLOADS = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const SESSION_TTL=30*24*60*60*1000; // 30 kun
// ---- Topshirilgan testlar (submissions) ----
const SUBMISSION_STATUS={pending_admin:'Admin javobi kutilmoqda',in_review:'Tekshirilmoqda',ready:'Natija tayyor'};
const SUBMISSION_CATEGORIES=['multilevel','speaking','listening','writing','reading'];
const CATEGORY_LABELS={multilevel:'Multilevel',speaking:'Speaking',listening:'Listening',writing:'Writing',reading:'Reading'};
// true: foydalanuvchining shu testdagi topshirig'i hali tekshirilmagan bo'lsa, yangi urinish boshlab bo'lmaydi
const BLOCK_RETAKE_WHILE_PENDING=true;
const tokenHash=t=>crypto.createHash('sha256').update(String(t||'')).digest('hex');
const sessions={ // sessiyalar data.json ichida saqlanadi: server qayta ishga tushsa ham tizimdan chiqib ketmaysiz
  get(t){if(!t)return undefined;const d=load(),k=tokenHash(t),s=d.sessions&&d.sessions[k];if(!s)return undefined;if(Date.now()-s.createdAt>SESSION_TTL){delete d.sessions[k];save(d);return undefined;}return s;},
  set(t,v){const d=load();d.sessions=d.sessions||{};d.sessions[tokenHash(t)]={...v,createdAt:Date.now()};save(d);},
  delete(t){const d=load(),k=tokenHash(t);if(d.sessions&&d.sessions[k]){delete d.sessions[k];save(d);}}
};
const now = () => new Date().toISOString();
// ---- Xavfsizlik: admin hisobi (Railway Variables) va login urinishlarini cheklash ----
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'';
const ADMIN_RESET=process.env.ADMIN_RESET==='1'; // 1 bo'lsa, ADMIN_PASSWORD har safar majburan o'rnatiladi (parolni unutsangiz)
const LOGIN_WINDOW=15*60*1000;
const loginFails=new Map();
const clientIp=req=>String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',').pop().trim();
const loginKeys=(req,ident)=>['ip:'+clientIp(req),'id:'+String(ident||'').toLowerCase().slice(0,120)];
const loginLimit=k=>k.startsWith('id:')?15:6;
function loginLocked(keys){const t=Date.now();let w=0;for(const k of keys){const r=loginFails.get(k);if(r&&r.until>t)w=Math.max(w,Math.ceil((r.until-t)/60000));}return w;}
function loginFail(keys){const t=Date.now();for(const k of keys){let r=loginFails.get(k);if(!r||t-r.first>LOGIN_WINDOW)r={n:0,first:t,until:0};r.n++;if(r.n>=loginLimit(k))r.until=t+LOGIN_WINDOW;loginFails.set(k,r);}}
function loginOk(keys){for(const k of keys)loginFails.delete(k);}
setInterval(()=>{const t=Date.now();for(const [k,r] of loginFails)if(t-r.first>LOGIN_WINDOW&&r.until<t)loginFails.delete(k);},10*60*1000).unref();
const id = (p='id') => `${p}_${crypto.randomUUID()}`;
const hash = (value, salt=crypto.randomBytes(16).toString('hex')) => {
  const digest = crypto.scryptSync(value, salt, 64).toString('hex'); return `${salt}:${digest}`;
};
const validPassword = (value, stored) => { const [salt, digest] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hash(value, salt).split(':')[1], 'hex')); };
function seed() {
  let adminPlain=ADMIN_PASSWORD;if(!adminPlain){adminPlain=crypto.randomBytes(12).toString('base64url');console.log('DIQQAT: ADMIN_PASSWORD berilmagan. Vaqtinchalik admin paroli: '+adminPlain);}
  const adminPass = hash(adminPlain);
  return { users:[
    {id:'u_admin',name:'Platform Admin',email:ADMIN_EMAIL||'admin@cefrmaster.uz',phone:'+998 90 000 00 00',region:'Toshkent',role:'admin',password:adminPass,status:'active',createdAt:now(),...MEMBERSHIP_DEFAULTS},
  ], tests:[
    {id:'ml-01',title:'Multi-Level Mock Test 01',category:'multilevel',description:'To‘liq CEFR sinov imtihoni',duration:120,price:0,status:'published',access:'free',modules:['listening','reading','writing','speaking']},
    {id:'ml-02',title:'Multi-Level Mock Test 02',category:'multilevel',description:'B1–B2 daraja uchun sinov',duration:120,price:39000,status:'published',access:'paid',modules:['listening','reading','writing','speaking']},
    {id:'listen-01',title:'Listening Practice 01',category:'listening',description:'Tinglab tushunish mashqlari',duration:35,price:0,status:'published',access:'free',modules:['listening']}
  ], supportTickets:[], questions:[
    {id:'q1',testId:'ml-01',module:'reading',type:'single',text:'Read the passage. What is the main purpose of the library?',passage:'The Riverside Community Library has introduced a digital borrowing service. Members can now borrow e-books and audiobooks from home, at any time. The service was designed to make reading more accessible for people with busy schedules.',options:['To replace printed books','To make borrowing more convenient','To teach people computer skills','To reduce membership fees'],correct:1,points:1},
    {id:'q2',testId:'ml-01',module:'reading',type:'single',text:'According to the passage, who benefits from the new service?',passage:'The Riverside Community Library has introduced a digital borrowing service. Members can now borrow e-books and audiobooks from home, at any time. The service was designed to make reading more accessible for people with busy schedules.',options:['Only librarians','People with busy schedules','Only children','People without internet'],correct:1,points:1},
    {id:'q3',testId:'ml-01',module:'listening',type:'single',text:'What will the speakers do on Saturday?',audioText:'Audio transcript: “Let’s meet at the study centre on Saturday morning to prepare for the exam.”',options:['Go shopping','Prepare for an exam','Visit a museum','Watch a film'],correct:1,points:1},
    {id:'q4',testId:'ml-01',module:'writing',type:'writing',text:'Task 1: Write an email to your friend describing a useful study habit you have developed. Write at least 80 words.',points:25},
    {id:'q5',testId:'ml-01',module:'speaking',type:'speaking',text:'Describe a place in your city that you would recommend to a visitor. You have one minute to prepare and two minutes to speak.',points:25},
    {id:'q6',testId:'listen-01',module:'listening',type:'single',text:'Where does the train leave from?',audioText:'Audio transcript: “The train to Bukhara departs from platform three at 9:15.”',options:['Platform one','Platform two','Platform three','Platform four'],correct:2,points:1}
  ], attempts:[], answers:[], evaluations:[], certificates:[], settings:{siteName:'CEFR MASTER', thresholds:{A1:0,A2:25,B1:45,B2:60,C1:75,C2:90},allowReview:true} };
}
function improveProfessionalBank(d){
  const readingExtension='The organisers emphasise that the outcome should be judged over time rather than by one enthusiastic reaction. They plan to collect feedback, compare it with measurable results and revise the arrangement where necessary. This approach recognises that public projects involve competing needs, limited resources and people whose experiences are not identical. It also gives readers a reason to distinguish evidence from assumption when they evaluate a proposed change.';
  const reading=[
    ['Urban shade',`When the municipality of Northbridge replaced several unused parking bays with small planted islands, the project was initially described as a cosmetic improvement. The first summer changed that view. The trees reduced the temperature of the pavement, while benches encouraged older residents to pause during their walks. Shop owners also noticed that people spent more time in the area instead of passing through it quickly. The scheme was not presented as a complete answer to the city’s climate problems: the planted areas were small and required regular watering. Its value lay in showing how modest, carefully chosen changes could improve comfort and social life at the same time. After six months, the council decided to extend the project around two schools, where shade and safer crossing points were considered especially important.`,['Why did the council extend the project?','The first phase produced practical benefits','Shop owners requested longer opening hours','The city needed more parking','The trees required less water'],0],
    ['Repair culture',`A community workshop in Easton began with a simple question: what happens to household items that stop working? Rather than offering another recycling collection, the organisers invited residents to bring broken lamps, bicycles and small appliances to weekly repair sessions. Volunteers with different skills showed visitors how to diagnose faults and replace inexpensive parts. The sessions did not save every object, but they changed the way participants thought about waste. Several people said they had previously thrown away items because they assumed repair would be complicated or expensive. The organisers now record the most common faults and publish short guides online. Their aim is not to make every resident a technician; it is to make maintenance a normal first step before replacement.`,['What is the main aim of the workshop?','To help people consider repair before replacement','To sell specialist tools','To train professional engineers','To collect household rubbish'],0],
    ['Flexible study',`A college compared two revision programmes before its end-of-year examinations. One group attended a single long session every Saturday, while another studied for twenty-five minutes on four different days. Both groups completed the same practice tests and received identical teaching. The second group remembered slightly more information after three weeks, particularly when learners tested themselves rather than simply rereading notes. Researchers cautioned that the experiment did not prove that short sessions suit everyone. Students with complex projects still needed longer periods for planning and discussion. The useful conclusion was more specific: regular retrieval and a realistic schedule may be more effective than concentrating all revision into one exhausting day.`,['What conclusion does the passage support?','Regular retrieval can make revision more effective','Long study sessions are always harmful','Practice tests should be avoided','All students need exactly twenty-five minutes'],0],
    ['Public data',`The district of Lalehabad published a monthly transport dashboard after residents complained that service changes were difficult to understand. The dashboard combines timetable information with explanations of delays and planned roadworks. At first, the team included every available measurement, but readers found the page confusing. In response, designers reduced the number of charts and added short notes explaining what each figure meant. The revised version received fewer visits from researchers, yet ordinary passengers used it more often. This result led the transport office to distinguish between data collected for specialists and information designed for daily decisions. The project suggests that transparency depends not only on releasing information but also on presenting it in a form people can interpret.`,['What did the transport office learn?','Useful transparency requires understandable presentation','Researchers should never use dashboards','Passengers prefer more charts','Roadworks should not be reported'],0],
    ['Museum voices',`For a new exhibition about migration, the Harbour Museum changed its usual research process. Curators had traditionally selected objects from the museum archive and written labels themselves. This time they invited local families to contribute photographs, recipes and recorded memories. Some accounts contradicted official documents, so the team did not treat every memory as a precise historical record. Instead, the exhibition placed personal stories beside archival evidence and explained why the two might differ. Visitors responded positively to the combination. Many said the displays helped them understand that history includes both public events and private experiences. The museum plans to use the same collaborative approach for future exhibitions, while keeping clear notes about the source of every item.`,['Why were personal stories shown beside archival evidence?','To present different kinds of historical evidence','To prove that official documents are incorrect','To reduce the number of museum objects','To avoid explaining where items came from'],0],
    ['Workplace mentoring',`A technology company introduced a mentoring scheme for new employees, but its first design produced disappointing results. Senior staff were asked to meet junior colleagues once a month, yet many pairs discussed only immediate tasks. After interviews with participants, the organisers changed the programme. Each pair now agrees on a longer-term goal, records one question before every meeting and reviews progress at the end of the quarter. The revised scheme takes slightly more preparation, but employees report that conversations are more focused. Managers also discovered that mentoring is not a one-way transfer of knowledge: newer staff often share useful perspectives on customer behaviour and digital tools.`,['What change made the mentoring scheme more focused?','Pairs prepared goals and questions before meetings','Managers increased the number of employees','New staff stopped sharing ideas','Meetings became shorter and less regular'],0],
    ['Coastal planning',`Residents of Miran Bay were divided over a proposed sea wall. Fishermen wanted protection for the road beside the harbour, while environmental groups warned that a solid barrier could alter the movement of sand and damage nearby wetlands. The final plan combined several measures: a lower barrier near the road, restored dunes further along the shore and a monitoring programme. The arrangement cost more than the original proposal, but it allowed engineers to adjust sections if evidence showed unexpected effects. The consultation process was slow and sometimes frustrating. Nevertheless, the planning committee concluded that long-term protection required both immediate safety measures and attention to the coastal system as a whole.`,['Why was the final plan more complex than the original?','It had to balance safety with environmental effects','The road was moved inland','Fishermen rejected all protection','The monitoring programme replaced the barrier'],0],
    ['Language exchange',`A public library launched an evening language exchange for residents who had recently moved to the city and people who wanted to practise another language. The organisers avoided formal lessons. Instead, each meeting used a practical theme, such as renting a flat or visiting a doctor, and participants changed partners several times. Attendance grew after the library introduced a quiet conversation table for learners who felt nervous speaking in a large group. Volunteers noticed that the most confident participants were not always the best teachers. Patience, clear questions and a willingness to explain everyday expressions mattered more than advanced grammar knowledge.`,['Why was a quiet conversation table added?','To give nervous learners a lower-pressure way to participate','To separate fluent speakers permanently','To replace practical themes with grammar lessons','To reduce attendance'],0],
    ['Food resilience',`The Green Basket project links small farms with schools and neighbourhood kitchens. Farmers receive predictable orders for seasonal produce, while cooks design menus around what is available rather than expecting the same ingredients all year. The approach has reduced packaging and helped pupils learn why prices and varieties change from one season to the next. It has not removed every difficulty: bad weather can still reduce supply, and kitchen staff need time to adapt recipes. Organisers therefore describe the project as a more resilient local system, not a guarantee of permanent self-sufficiency. Its success depends on cooperation between producers, institutions and consumers.`,['What does the project demonstrate?','Local food systems can become more adaptable through cooperation','Schools can avoid seasonal changes completely','Farmers no longer depend on weather','Packaging is the only food problem'],0],
    ['Digital focus',`A university introduced software that limited access to social media during scheduled study periods. Some students welcomed the reminder, while others argued that they needed online platforms for research and group work. The university therefore made the system adjustable rather than compulsory. Students could pause a block when a course required a particular site, and the software displayed a weekly report instead of judging individual behaviour. Early feedback suggested that the report helped students notice patterns without making them feel monitored. The project team concluded that digital wellbeing tools are more likely to work when they support informed choices instead of pretending that one setting suits everyone.`,['What principle guided the revised software?','Students should be supported in making informed choices','All online platforms should be blocked','Study behaviour should be judged publicly','Research websites are unnecessary'],0]
  ];
  const listening=[
    ['A delayed appointment','A clinic receptionist explains that a doctor is delayed by twenty minutes and offers the patient either a later appointment or a different specialist.', ['The doctor is running late','The clinic has closed','The patient forgot the appointment','The specialist is on holiday'],0],
    ['A revised bus route','A transport officer announces that route 18 will use Oak Street while bridge repairs continue. Passengers should board near the community centre.', ['The temporary route uses Oak Street','The bridge has reopened','Passengers must use the railway','The community centre is closed'],0],
    ['A research presentation','A student tells her partner that she will present the survey results first and explain the limitations afterwards, because the audience needs the main finding immediately.', ['She will present the main finding first','She will cancel the presentation','She will remove the survey','She will discuss limitations only'],0],
    ['A hotel request','A guest asks reception for a quieter room away from the lift. The receptionist cannot change rooms immediately but promises to call when one becomes available.', ['The guest wants a quieter room','The lift is broken','The hotel has no rooms','The guest wants a late checkout'],0],
    ['A community event','The organiser says the outdoor film will move inside if rain begins before seven, and advises visitors to keep their tickets because the programme will remain unchanged.', ['The event has an indoor alternative','The film has been cancelled','Tickets will become invalid','The programme will change completely'],0],
    ['A workplace update','A manager explains that the new booking system launches on Monday, but staff should continue using the old form for clients whose appointments were already confirmed.', ['Existing confirmed appointments use the old form','The new system starts next month','Clients must cancel appointments','The old form is unavailable'],0],
    ['A museum guide','The guide points out that the portrait was restored last year and that visitors should look at the lower corner to see the original paint beneath a small area of damage.', ['The portrait was restored last year','The portrait was painted last year','Visitors may touch the painting','The damage covers the whole portrait'],0],
    ['A university notice','Students are told that the science laboratory will close at five on Friday for maintenance, although the library and study rooms will remain open as usual.', ['The laboratory will close early on Friday','The library will close at five','Maintenance starts on Monday','Study rooms are unavailable'],0],
    ['A travel change','A rail employee explains that the direct train is full, but a connecting service leaves ten minutes later and reaches the same destination with one change.', ['The passenger can take a later connecting service','The destination has changed','The direct train leaves earlier','All trains have been cancelled'],0],
    ['A neighbourhood meeting','The chair asks residents to send written comments before Thursday because the committee will vote on the proposed park design at its next meeting.', ['Comments are needed before the vote','The park has already opened','Residents must vote today','The design cannot be changed'],0]
  ];
  const writing=[
    'Write an email to a college administrator requesting a timetable change. Explain the conflict and propose a practical alternative in 150–180 words.',
    'Write a report for a community centre evaluating a new evening class. Describe attendance, benefits and two recommendations in 180–220 words.',
    'Write an opinion essay: Some people believe cities should charge drivers to enter busy centres. Discuss both views and give your position in 220–260 words.',
    'Write a formal letter to a landlord about repeated noise at night. Explain the effect on you and request specific action in 150–180 words.',
    'Write a proposal for your school on how to reduce single-use plastic. Include priorities, costs and expected results in 180–220 words.',
    'Write an article for a student magazine about whether part-time work benefits university students. Use examples and a balanced conclusion in 220–260 words.',
    'Write a report comparing two possible locations for a public reading room. Recommend one location and justify your choice in 180–220 words.',
    'Write an email to an international colleague explaining a local workplace custom and how visitors should prepare for it in 150–180 words.',
    'Write an essay discussing whether employers should allow staff to work remotely whenever possible. Support your view with reasons in 220–260 words.',
    'Write a review of a public exhibition, lecture or performance you attended. Evaluate its content and recommend improvements in 180–220 words.'
  ];
  const speaking=[
    'Answer questions about a daily health habit and explain how it affects your energy and concentration.',
    'Describe a technology that has changed the way you communicate. Compare its advantages and limitations.',
    'Talk about a place in your region that should be better protected. Give reasons and practical suggestions.',
    'Compare studying alone with studying in a group. Explain which works better for you and why.',
    'Describe a difficult decision you made and evaluate the information that helped you choose.',
    'Give your opinion on whether public transport should be free for young people. Support it with examples.',
    'Discuss how schools can encourage students to read for pleasure rather than only for examinations.',
    'Describe a community project you would organise and explain who would benefit from it.',
    'Compare two ways of learning a language and recommend one for a busy adult learner.',
    'Discuss whether modern workplaces should measure results instead of time spent at a desk.'
  ];
  d.tests.filter(test=>/^ml-\d+$/.test(test.id)).forEach(test=>{
    d.questions=d.questions.filter(q=>!(q.testId===test.id&&/^q[1-5]$/.test(q.id)));
    const number=Number(test.id.slice(3));
    const qs=d.questions.filter(q=>q.testId===test.id).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
    const set=(q,values)=>Object.assign(q,values);
    qs.slice(0,10).forEach((q,i)=>{const item=listening[(i+number-1)%listening.length];set(q,{module:'listening',type:'single',text:`Listening Part ${i+1}: ${item[0]}. What is the key message?`,audioText:`Audio script: ${item[1]}`,options:item[2],correct:item[3],points:1});});
    qs.slice(10,20).forEach((q,i)=>{const item=reading[(i+number-1)%reading.length];const [qText,...opts]=item[2];set(q,{module:'reading',type:'single',text:`Reading Part ${i+1}: ${qText}`,passage:`${item[1]} ${readingExtension}`,options:opts,correct:item[3],points:1});});
    qs.slice(20,30).forEach((q,i)=>set(q,{module:'writing',type:'writing',text:`Writing Task ${i+1}: ${writing[(i+number-1)%writing.length]}`,points:25}));
    qs.slice(30,40).forEach((q,i)=>set(q,{module:'speaking',type:'speaking',text:`Speaking Task ${i+1}: ${speaking[(i+number-1)%speaking.length]} Preparation: 60 seconds. Speaking: up to 2 minutes.`,points:25,preparationSeconds:60,speakingSeconds:120}));
  });
}
function enrichCatalog(d){
  const additions=[
    {id:'reading-01',title:'Reading Focus: City Life',category:'reading',description:'B1–B2 uchun akademik o‘qish va detail savollar.',duration:35,price:0,status:'published',access:'free',modules:['reading']},
    {id:'writing-01',title:'Writing Workshop: Opinion Essay',category:'writing',description:'Task planning, yozish va examiner feedback bilan amaliyot.',duration:45,price:0,status:'published',access:'free',modules:['writing']},
    {id:'speaking-01',title:'Speaking Studio: Everyday Topics',category:'speaking',description:'Tayyorlanish va real audio javob bilan speaking mashg‘uloti.',duration:20,price:0,status:'published',access:'free',modules:['speaking']},
    {id:'listen-02',title:'Listening Focus: Campus News',category:'listening',description:'Eshitib tushunish bo‘yicha qisqa, aniq amaliyot.',duration:25,price:0,status:'published',access:'free',modules:['listening']}
  ];
  additions.forEach(t=>{if(!d.tests.some(x=>x.id===t.id))d.tests.push(t)});
  const listeningTests=[
    {id:'listen-03',title:'Listening Focus: Travel Desk',category:'listening',description:'Sayohat, jadval va xizmatlar haqidagi original audio mashqlar.',duration:25,price:0,status:'published',access:'free',modules:['listening']},
    {id:'listen-04',title:'Listening Focus: Work & Study',category:'listening',description:'Ish va o‘qish mavzularidagi original audio mashqlar.',duration:30,price:0,status:'published',access:'free',modules:['listening']}
  ];
  listeningTests.forEach(t=>{if(!d.tests.some(x=>x.id===t.id))d.tests.push(t)});
  const qs=[
    {id:'r1',testId:'reading-01',module:'reading',type:'single',text:'Why did the council create the car-free zone?',passage:'Last spring, the city council closed Market Street to private cars at weekends. The decision followed a survey in which local residents asked for safer walking and cycling routes. Since then, cafés have placed tables outside and visitor numbers have increased.',options:['To reduce café prices','To provide safer streets','To build new parking spaces','To shorten bus routes'],correct:1,points:1},
    {id:'r2',testId:'reading-01',module:'reading',type:'single',text:'What has happened since the change?',passage:'Last spring, the city council closed Market Street to private cars at weekends. The decision followed a survey in which local residents asked for safer walking and cycling routes. Since then, cafés have placed tables outside and visitor numbers have increased.',options:['Fewer people visit the area','Cafés have closed','More visitors come to the street','Buses no longer run'],correct:2,points:1},
    {id:'w1',testId:'writing-01',module:'writing',type:'writing',text:'Write an opinion essay for your school website: “Online learning is more effective than classroom learning.” Discuss both sides and give your opinion. Write 180–220 words.',points:100},
    {id:'s1',testId:'speaking-01',module:'speaking',type:'speaking',text:'Talk about a skill you would like to learn. Explain why you chose it, how you would learn it, and how it could be useful in your life. Preparation: 60 seconds. Speaking: up to 2 minutes.',points:100},
    {id:'l2',testId:'listen-02',module:'listening',type:'single',text:'What change will take place in the library next week?',audioText:'Transcript for practice: “Attention students. From Monday, the library will remain open until 9 p.m. during the examination period. The computer room will move to the first floor while repairs are completed.”',options:['It will close earlier','It will stay open later','The café will be repaired','Books will be moved outside'],correct:1,points:1},
    {id:'l3',testId:'listen-02',module:'listening',type:'single',text:'Where will the computer room be temporarily?',audioText:'Transcript for practice: “Attention students. From Monday, the library will remain open until 9 p.m. during the examination period. The computer room will move to the first floor while repairs are completed.”',options:['In the basement','On the first floor','In the café','Outside the library'],correct:1,points:1}
  ];
  qs.forEach(q=>{if(!d.questions.some(x=>x.id===q.id))d.questions.push(q)});
  const listeningQuestions=[
    {id:'l4',testId:'listen-03',module:'listening',type:'single',text:'What time does the guided tour begin?',audioText:'Hello, visitors. The guided tour begins at half past ten near the main entrance. Please arrive ten minutes early.',options:['10:00','10:20','10:30','11:00'],correct:2,points:1},
    {id:'l5',testId:'listen-03',module:'listening',type:'single',text:'Where should visitors wait?',audioText:'Hello, visitors. The guided tour begins at half past ten near the main entrance. Please arrive ten minutes early.',options:['At the café','Near the main entrance','At the bus stop','In the museum shop'],correct:1,points:1},
    {id:'l6',testId:'listen-04',module:'listening',type:'single',text:'Why has the study group changed rooms?',audioText:'The study group will meet in Room 204 today because the usual room is being cleaned. The session still starts at six o’clock.',options:['The usual room is being cleaned','The teacher is late','The session was cancelled','The library is closed'],correct:0,points:1},
    {id:'l7',testId:'listen-04',module:'listening',type:'single',text:'What time does the session start?',audioText:'The study group will meet in Room 204 today because the usual room is being cleaned. The session still starts at six o’clock.',options:['Five o’clock','Half past five','Six o’clock','Seven o’clock'],correct:2,points:1}
  ];
  listeningQuestions.forEach(q=>{if(!d.questions.some(x=>x.id===q.id))d.questions.push(q)});
  const readingTopics=[
    ['City transport','The city introduced a weekend bus pass to make travel cheaper and reduce traffic.'],
    ['Healthy routines','A local school created a ten-minute morning walk for students and teachers.'],
    ['Digital libraries','Members can borrow digital books from home at any time of day.'],
    ['Community gardens','Residents turned an unused space into a garden for food and conversation.'],
    ['Study planning','Short, regular study sessions helped learners remember more information.'],
    ['Museum projects','The museum invited young people to design an exhibition about local history.'],
    ['Remote work','Employees requested flexible hours to reduce commuting and improve concentration.'],
    ['Public art','A neighbourhood used empty walls to display murals by local artists.'],
    ['Water conservation','Households were shown simple ways to reduce daily water use.'],
    ['Food markets','Small producers created a weekly market for fresh local food.'],
    ['Language exchange','Students met residents to practise languages and share stories.'],
    ['Bicycle safety','The council added protected lanes near schools and busy junctions.'],
    ['Library clubs','A library started evening clubs for readers of different ages.'],
    ['Solar energy','A community centre installed panels to lower its energy costs.'],
    ['Youth volunteering','Teenagers helped organise activities for older residents.'],
    ['Coastal protection','Scientists worked with residents to protect a fragile shoreline.'],
    ['Farm technology','Farmers tested sensors that measured soil moisture more accurately.'],
    ['Local journalism','A weekly newsletter reported decisions made by the town council.'],
    ['Music education','The school lent instruments to pupils who could not buy them.'],
    ['Park restoration','Volunteers removed litter and replanted native trees in a park.'],
    ['Online privacy','The workshop explained how people can protect personal information.'],
    ['Accessible design','The building was redesigned with ramps and clearer signs.'],
    ['Seasonal tourism','The town created winter events to attract visitors outside summer.'],
    ['Healthy lunches','The cafeteria added affordable meals with more vegetables.'],
    ['Science festivals','Researchers explained experiments through demonstrations for families.'],
    ['Recycling schemes','Residents received separate containers for paper, glass and food waste.'],
    ['Community radio','A local station gave residents a weekly space to share announcements.'],
    ['Exam preparation','Learners improved their results by planning short regular revision sessions.'],
    ['Urban trees','Street trees were planted to provide shade and support wildlife.'],
    ['Cultural archives','Volunteers recorded memories from older members of the community.'],
    ['Small businesses','A training programme helped shop owners improve digital services.'],
    ['Public transport','A new timetable connected outer neighbourhoods with the city centre.'],
    ['Outdoor classrooms','Teachers used a garden to make lessons more practical.']
  ];
  for(let n=1;n<=35;n++){
    const testId=`reading-${String(n).padStart(2,'0')}`;
    if(!d.tests.some(x=>x.id===testId))d.tests.push({id:testId,title:`Reading Practice ${String(n).padStart(2,'0')}`,category:'reading',description:'Original CEFR reading practice: main idea, detail and vocabulary.',duration:35,questionCount:5,price:0,status:'published',access:'free',modules:['reading']});
    const [topic,passage]=readingTopics[(n-1)%readingTopics.length];
    const prompts=[
      [`What is the main topic of the passage about ${topic.toLowerCase()}?`,['A recent local change','A historical war','A cooking lesson','A weather report'],0],
      [`Why was the change introduced?`,['To solve a practical problem','To cancel a service','To reduce learning time','To advertise a product'],0],
      [`What can readers understand from the passage?`,['The change has a useful purpose','Nobody supports the idea','The project has ended','The service is only for visitors'],0],
      [`Which word best describes the project?`,['Practical','Dangerous','Unrelated','Temporary'],0],
      [`What is the writer’s main aim?`,['To inform readers','To sell a ticket','To invite complaints','To describe a recipe'],0]
      ,[`Which statement is supported by the passage?`,['The project responds to a real need','The project has no clear purpose','The service is only for staff','The change happened many years ago'],0]
      ,[`What would be a suitable title for this passage?`,[`${topic} in everyday life`,'A difficult examination','An international competition','A restaurant menu'],0]
      ,[`Who is most likely to benefit from this idea?`,['Local people and learners','Only professional athletes','Only tourists','Nobody in the community'],0]
      ,[`What can readers expect after the change?`,['A practical improvement','A completely different subject','A cancelled programme','A private invitation'],0]
      ,[`Which detail is central to the passage?`,['The way the idea helps everyday life','The price of an unrelated product','A fictional character','A sports result'],0]
      ,[`What is the best conclusion?`,['Small changes can create useful results','The project should be forgotten','The topic is impossible to understand','The service is only for experts'],0]
      ,[`Which statement is true according to the passage?`,['The project was planned for a practical reason','The project was never discussed','The project concerns a different country','The project has no participants'],0,'true_false']
      ,[`Which heading best matches this paragraph?`,['A local response','An ancient tradition','A private competition','A weather warning'],0,'matching']
      ,[`Where did the change take place?`,['In the local community','At an international airport','Inside a private factory','In a distant country'],0,'single']
      ,[`Complete the sentence: The project was designed to...`,['help people in everyday life','replace every public service','close the community centre','reduce access to information'],0,'gap']
      ,[`What does “it” refer to in the passage?`,['The project or service','A person mentioned in another article','The weather','A building in another city'],0,'text']
      ,[`Which option is NOT mentioned?`,['A practical benefit','A local participant','A clear reason','An international prize'],3,'single']
      ,[`What can be inferred from the passage?`,['People supported a useful improvement','Everyone rejected the project','The service was available only once','The topic was unrelated to residents'],0,'single']
      ,[`Choose TWO details that describe the project.`,['It is local','It has a practical purpose','It is a sports event','It is a foreign policy'],[0,1],'multiple']
      ,[`What is the closest meaning of “introduced”?`,['Started','Removed','Forgotten','Hidden'],0,'text']
      ,[`Which sentence best summarises the passage?`,['A community creates a useful response to a shared need','A business closes without explanation','A visitor cancels a private trip','A scientist reports an unrelated discovery'],0,'gap']
      ,[`Who benefits most directly?`,['Residents and learners','Only professional actors','Only international visitors','No one'],0,'single']
      ,[`What happened before the project?`,['People identified a need or problem','The project had already ended','A national election was held','A festival was cancelled'],0,'single']
      ,[`What is the writer’s attitude?`,['Informative and positive','Angry and personal','Uncertain and secretive','Humorous and unrelated'],0,'single']
      ,[`Which heading belongs to the second paragraph?`,['Practical results','A list of old prices','A fictional dialogue','A travel advertisement'],0,'matching']
      ,[`Complete the summary: The initiative connects a local idea with...`,['a useful everyday result','a private examination','an unrelated hobby','a weather forecast'],0,'gap']
      ,[`Is this statement True, False or Not Given: The project was funded by an international company.`,['True','False','Not Given'],2,'true_false']
      ,[`Which fact would support the writer’s argument?`,['Residents use the service regularly','The building has a blue door','The event happened in another country','The article has three paragraphs'],0,'single']
      ,[`What problem does the initiative address?`,['A practical local problem','A fictional mystery','A sports injury','A private disagreement'],0,'single']
      ,[`Which word could replace “local”?`,['Community-based','Distant','Unrelated','Imaginary'],0,'text']
      ,[`What is the purpose of the final sentence?`,['To show the value of the change','To introduce a new character','To advertise a product','To reject the main idea'],0,'single']
      ,[`Choose TWO ideas included in the passage.`,['A reason for the change','An expected benefit','A recipe','A train timetable'],[0,1],'multiple']
      ,[`What would be a suitable question for further research?`,['How many people use the initiative?','What is the weather on another continent?','Who won an unrelated match?','What is a fictional character’s name?'],0,'single']
      ,[`Which answer best completes the sentence: The passage suggests that...`,['small organised actions can help a community','local projects are always unsuccessful','readers should ignore the evidence','only experts can understand the topic'],0,'gap']
      ,[`What is the key contrast in the passage?`,['A problem is followed by a practical response','A holiday is compared with a storm','A book is compared with a film','A city is compared with a country'],0,'single']
      ,[`What does the evidence show?`,['The idea has a measurable purpose','The idea is purely fictional','The idea belongs to another subject','The idea has no audience'],0,'single']
      ,[`Which statement is Not Given?`,['The exact launch date','The project’s practical aim','The people who may benefit','The general topic'],0,'true_false']
      ,[`Select the best answer for the missing detail.`,['A clear benefit for participants','A celebrity interview','A restaurant bill','A sports result'],0,'gap']
      ,[`How is the passage organised?`,['Problem, action and result','Question, recipe and advertisement','History, map and timetable','Dialogue, joke and warning'],0,'matching']
      ,[`What lesson can readers take from the passage?`,['Community planning can produce useful change','Every public project should be cancelled','Only private companies can solve problems','Evidence is unnecessary'],0,'single']
      ,[`Which option best describes the source?`,['A short informative report','A fictional poem','A personal diary','A product receipt'],0,'single']
      ,[`What would be the best final heading?`,['Why the initiative matters','A list of unrelated names','A guide to cooking','A weather bulletin'],0,'matching']
    ];
    const existingCount=d.questions.filter(q=>q.testId===testId).length;
    prompts.slice(existingCount ? Math.max(0, prompts.length - Math.max(0, 11 - existingCount)) : 0).forEach((item,index)=>{const qNumber=existingCount+index+1,qId=`${testId}-q${qNumber}`;if(qNumber<=11&&!d.questions.some(x=>x.id===qId))d.questions.push({id:qId,testId,module:'reading',type:'single',text:item[0],passage:`${topic}: ${passage}`,options:item[1],correct:item[2],points:1});});
  }
  const examTopics=['education','city life','health and wellbeing','technology','environment','workplace','travel','community','science','culture'];
  const makeTest=(test)=>{if(!d.tests.some(x=>x.id===test.id))d.tests.push(test);};
  const addQuestion=(question)=>{if(!d.questions.some(x=>x.id===question.id))d.questions.push(question);};
  for(let n=1;n<=30;n++){
    const topic=examTopics[(n-1)%examTopics.length];
    const listenId=`listen-${String(n).padStart(2,'0')}`;
    makeTest({id:listenId,title:`Listening Exam ${String(n).padStart(2,'0')}`,category:'listening',description:`Four-part listening examination about ${topic}.`,duration:40,price:0,status:'published',access:'free',modules:['listening'],audioPolicy:'unlimited'});
    for(let q=1;q<=35;q++){const type=q%5===0?'multiple':q%5===1?'true_false':q%5===2?'gap':'single';const audio=`Listening Exam ${n}, section ${Math.ceil(q/9)}. The speaker discusses ${topic}, gives one practical example, and explains why the change matters to local people.`;addQuestion({id:`${listenId}-q${q}`,testId:listenId,module:'listening',type,text:`${type==='gap'?'Complete the sentence.':type==='true_false'?'Is the statement true or false?':`Question ${q}: What is the key point about ${topic}?`}`,audioText:audio,options:type==='single'?['The main plan','A cancelled event','An unrelated problem','A private message']:type==='multiple'?['The main plan','A practical example','An unrelated problem','A private message']:['True','False'],correct:type==='multiple'?[0,1]:type==='true_false'?0:0,points:1});}
    const readingId=`reading-${String(n).padStart(2,'0')}`;
    const readingTest=d.tests.find(x=>x.id===readingId); if(readingTest){readingTest.duration=35;}
    const writingId=`writing-${String(n).padStart(2,'0')}`;
    makeTest({id:writingId,title:`Writing Exam ${String(n).padStart(2,'0')}`,category:'writing',description:`Task 1 and Task 2 writing examination about ${topic}.`,duration:60,price:0,status:'published',access:'free',modules:['writing']});
    for(let q=1;q<=35;q++)addQuestion({id:`${writingId}-q${q}`,testId:writingId,module:'writing',type:'writing',text:q===1?`Task 1: Write an email or report about ${topic} in 120–150 words.`:q===2?`Task 2: Write an opinion essay about ${topic}. Discuss both views and give your position in 220–260 words.`:`Writing planning task ${q}: Develop one clear argument connected with ${topic}.`,points:q<=2?25:2});
    const speakingId=`speaking-${String(n).padStart(2,'0')}`;
    makeTest({id:speakingId,title:`Speaking Exam ${String(n).padStart(2,'0')}`,category:'speaking',description:`Three-part speaking examination about ${topic}.`,duration:25,price:0,status:'published',access:'free',modules:['speaking']});
    for(let q=1;q<=35;q++)addQuestion({id:`${speakingId}-q${q}`,testId:speakingId,module:'speaking',type:'speaking',text:q<=10?`Part 1: Answer the personal question about ${topic}.`:q<=20?`Part 2: Prepare and speak for two minutes about ${topic}.`:q<=30?`Part 3: Discuss the advantages and disadvantages of ${topic}.`:`Follow-up speaking task ${q}: Give a reason and an example.`,points:q<=30?3:2,preparationSeconds:q<=20?60:30,speakingSeconds:q<=20?120:60});
  }
  for(let n=1;n<=20;n++){
    const idValue=`ml-${String(n).padStart(2,'0')}`;
    makeTest({id:idValue,title:`Multi-Level Mock Exam ${String(n).padStart(2,'0')}`,category:'multilevel',description:'Complete Listening, Reading, Writing and Speaking examination.',duration:150,price:n===1?0:39000,status:'published',access:n===1?'free':'paid',modules:['listening','reading','writing','speaking']});
    for(let q=1;q<=40;q++){const module=q<=10?'listening':q<=20?'reading':q<=30?'writing':'speaking';const type=module==='listening'?'single':module==='reading'?'single':module;addQuestion({id:`${idValue}-q${q}`,testId:idValue,module,type,text:`${module[0].toUpperCase()+module.slice(1)} section task ${q} about ${examTopics[(n+q)%examTopics.length]}.`,passage:module==='reading'?`Read the passage about ${examTopics[(n+q)%examTopics.length]} and answer the question.`:'',audioText:module==='listening'?`Audio section ${Math.ceil(q/3)} about ${examTopics[(n+q)%examTopics.length]}.`:'',options:type==='single'?['The main idea','A minor detail','An unrelated point','No information']:[],correct:type==='single'?0:null,points:module==='writing'||module==='speaking'?3:1});}
  }
  d.tests.forEach(test=>{test.questionCount=d.questions.filter(q=>q.testId===test.id).length;});
  improveProfessionalBank(d);
  return d;
}
function applyAdminCredentials(d){
  let changed=false;
  const adm=d.users.find(x=>x.id==='u_admin')||d.users.find(x=>x.role==='super_admin')||d.users.find(x=>x.role==='admin');
  if(adm){
    if(ADMIN_EMAIL&&adm.email!==ADMIN_EMAIL&&!d.users.some(x=>x!==adm&&x.email===ADMIN_EMAIL)){adm.email=ADMIN_EMAIL;changed=true;}
    if(ADMIN_PASSWORD){
      let isDefault=false,same=false;
      try{isDefault=validPassword('Admin@2026',adm.password);}catch{}
      try{same=validPassword(ADMIN_PASSWORD,adm.password);}catch{}
      if(!same&&(isDefault||ADMIN_RESET)){adm.password=hash(ADMIN_PASSWORD);adm.status='active';changed=true;console.log('Admin paroli Variables dagi ADMIN_PASSWORD ga almashtirildi.');}
    }
  }
  const demo=d.users.find(x=>x.email==='student@cefrmaster.uz');
  if(demo&&demo.status==='active'){let def=false;try{def=validPassword('Student@2026',demo.password);}catch{}if(def){demo.status='blocked';changed=true;console.log('Standart parolli demo o‘quvchi hisobi bloklandi.');}}
  return changed;
}
function loadFromDisk(){fs.mkdirSync(DATA_DIR,{recursive:true});let d;if(!fs.existsSync(DB)){d=seed();}else d=JSON.parse(fs.readFileSync(DB,'utf8'));d.questions=d.questions.filter(q=>!(q.testId==='reading-01'&&['reading-01-q10','reading-01-q11'].includes(q.id)));d.supportTickets ||= [];ensureMembershipFields(d);if(applyAdminCredentials(d)&&fs.existsSync(DB))fs.writeFileSync(DB,JSON.stringify(d));d.settings ||= {};d.settings.supportTelegram ||= '@onlytowinn';{const existed=fs.existsSync(DB);if(backfillSubmissions(d)&&existed)fs.writeFileSync(DB,JSON.stringify(d,null,2));}if(d.settings.lessonsArchived)return d;const before=JSON.stringify(d.tests).length+JSON.stringify(d.questions).length+JSON.stringify(d.supportTickets).length+JSON.stringify(d.settings).length;enrichCatalog(d);const after=JSON.stringify(d.tests).length+JSON.stringify(d.questions).length+JSON.stringify(d.supportTickets).length+JSON.stringify(d.settings).length;if(!fs.existsSync(DB)||after!==before)fs.writeFileSync(DB,JSON.stringify(d,null,2));return d; }
let CACHE=null,saveTimer=null,saving=false,dirty=false;
function load(){return CACHE||(CACHE=loadFromDisk());}
function writeNow(){const tmp=DB+'.tmp';fs.writeFileSync(tmp,JSON.stringify(CACHE));fs.renameSync(tmp,DB);dirty=false;}
function flush(){saveTimer=null;if(!dirty)return;if(saving){saveTimer=setTimeout(flush,150);return;}dirty=false;saving=true;const tmp=DB+'.tmp';fs.writeFile(tmp,JSON.stringify(CACHE),err=>{if(err){saving=false;dirty=true;console.error('Saqlash xatosi:',err.message);return;}fs.rename(tmp,DB,e=>{saving=false;if(e){dirty=true;console.error('Saqlash xatosi:',e.message);}if(dirty&&!saveTimer)saveTimer=setTimeout(flush,300);});});}
function save(d){CACHE=d;dirty=true;if(!saveTimer)saveTimer=setTimeout(flush,300);}
function flushSync(){if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}if(dirty&&CACHE){try{writeNow();}catch(e){console.error('Saqlash xatosi:',e.message);}}}
['SIGINT','SIGTERM'].forEach(sig=>process.on(sig,()=>{flushSync();process.exit(0);}));
process.on('exit',flushSync);
process.on('uncaughtException',e=>{console.error('Kutilmagan xato:',e);});
process.on('unhandledRejection',e=>{console.error('Kutilmagan rad etish:',e);});
function json(res,status,data){if(status===204||status===304){res.writeHead(status,{'Cache-Control':'no-store'});return res.end();}const raw=Buffer.from(JSON.stringify(data)),h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};if(raw.length>1024&&/\bgzip\b/.test(res.req?.headers['accept-encoding']||'')){h['Content-Encoding']='gzip';h['Vary']='Accept-Encoding';const z=zlib.gzipSync(raw,{level:4});h['Content-Length']=z.length;res.writeHead(status,h);return res.end(z);}h['Content-Length']=raw.length;res.writeHead(status,h);res.end(raw);}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>14*1024*1024){reject(new Error('Fayl hajmi 10 MB dan oshmasligi kerak'));req.destroy();}});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(new Error('Noto‘g‘ri so‘rov'));}});});}
function user(req, d){const token=(req.headers.authorization||'').replace('Bearer ',''); const s=sessions.get(token); const u=s&&d.users.find(x=>x.id===s.userId); if(u&&syncMembership(u))save(d); return u;}
function publicUser(u){const {password,membershipHistory,membershipType,membershipStatus,membershipStartDate,membershipExpireDate,...safe}=u;return {...safe,membership:membershipView(u)};}
function requireUser(req,res,d,role){const u=user(req,d);if(!u)return json(res,401,{error:'Avval tizimga kiring'});if(role&&u.role!==role)return json(res,403,{error:'Ruxsat yo‘q'});return u;}
// ---- VIP a‘zolik (membership) ----
// Ruxsatlar FAQAT serverda tekshiriladi. Foydalanuvchi tarifi faqat admin endpointi orqali o‘zgaradi.
const MEMBERSHIP_TYPES=['FREE','SILVER','GOLD','PLATINUM'];
const MEMBERSHIP_LABELS={FREE:'FREE',SILVER:'SILVER VIP',GOLD:'GOLD VIP',PLATINUM:'PLATINUM VIP'};
const MEMBERSHIP_ICONS={FREE:'',SILVER:'🥈',GOLD:'🥇',PLATINUM:'💎'};
const MEMBERSHIP_DURATIONS={'3d':{label:'3 kun',days:3},'7d':{label:'7 kun',days:7},'1m':{label:'1 oy',months:1},'1y':{label:'1 yil',months:12}};
const MEMBERSHIP_DEFAULTS={membershipType:'FREE',membershipStatus:'ACTIVE',membershipStartDate:null,membershipExpireDate:null};
// Har bir tarif FAQAT o‘zining YANGI ruxsatlarini e’lon qiladi; pastki tarifning hammasi avtomatik yuqorisiga
// o‘tadi (SILVER ⊂ GOLD ⊂ PLATINUM). Ierarxiyani o‘zgartirish uchun FAQAT shu ro‘yxatlarni tahrirlang — boshqa
// hech qayerda (frontend ham) ruxsat mantiqi takrorlanmaydi, u faqat shu yerdan kelgan locked/requiredPlan
// maydonlarini ko‘rsatadi. Gold Silverning hammasini + o‘zinikini oladi; Platinum EVERYTHING oladi.
const TIER_FEATURES={
  SILVER:['premium_lesson','premium_tests','extra_practice','vocabulary','grammar','result_history','vip_badge','premium_section'],
  GOLD:['all_lessons','multilevel_tests','speaking','writing','advanced_vocabulary','advanced_grammar','advanced_tests','extra_materials','gold_badge'],
  PLATINUM:['all_materials','all_tests','reading_materials','listening_materials','future_content','certificate','ad_free','platinum_badge','platinum_section','platinum_content']
};
const PLAN_FEATURES={FREE:[]};
(()=>{let acc=[];for(const t of ['SILVER','GOLD','PLATINUM']){acc=acc.concat(TIER_FEATURES[t]);PLAN_FEATURES[t]=acc.slice();}})();
const FEATURES=PLAN_FEATURES.PLATINUM.slice(); // = barcha mavjud ruxsat nomlari (eng yuqori tarifning to‘liq ro‘yxati)
// Ruxsat nomi -> foydalanuvchiga ko‘rsatiladigan o‘zbekcha matn (xato xabarlari va VIP sahifasi uchun).
const FEATURE_LABELS={
  premium_lesson:'Tanlangan premium darslar',premium_tests:'Tanlangan premium testlar',extra_practice:'Qo‘shimcha mashqlar',vocabulary:'Tanlangan lug‘at materiallari',grammar:'Tanlangan grammatika materiallari',result_history:'Natijalar tarixi',vip_badge:'VIP profil belgisi',premium_section:'Premium bo‘limga kirish',
  all_lessons:'Barcha premium darslar',multilevel_tests:'Barcha Multilevel mashq testlari',speaking:'Speaking mashqlari',writing:'Writing mashqlari',advanced_vocabulary:'Advanced lug‘at',advanced_grammar:'Advanced grammatika',advanced_tests:'Advanced testlar',extra_materials:'Qo‘shimcha o‘quv materiallari',gold_badge:'Gold profil belgisi',
  all_materials:'100% o‘quv materiallari',all_tests:'Barcha Multilevel va mashq testlari',reading_materials:'Reading materiallari',listening_materials:'Listening materiallari',future_content:'Kelajakdagi premium darslar (avtomatik)',certificate:'Premium (demo) sertifikat',ad_free:'Reklamasiz tajriba',platinum_badge:'Platinum profil belgisi',platinum_section:'Platinum bo‘lim',platinum_content:'Faqat Platinum uchun kontent'
};
const STAFF_BYPASS=['admin','super_admin']; // adminlar barcha kontentni ko‘ra oladi
const dmy=iso=>{const t=new Date(iso);return isNaN(t)?'—':t.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Tashkent'}).replace(/\//g,'.');};

// Sanaga muddat qo‘shadi. Oy/yil kalendar bo‘yicha: 31-yanvar + 1 oy = 28/29-fevral (keyingi oyga o‘tib ketmaydi).
function addDuration(from,key){
  const dur=MEMBERSHIP_DURATIONS[key],t=new Date(from);
  if(dur.days)return new Date(t.getTime()+dur.days*86400000);
  const day=t.getUTCDate();t.setUTCDate(1);t.setUTCMonth(t.getUTCMonth()+dur.months);
  const last=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();
  t.setUTCDate(Math.min(day,last));return t;
}
// Saqlangan yozuv (eski foydalanuvchilarda maydonlar bo‘lmasa — FREE)
function membershipOf(u){
  return {type:MEMBERSHIP_TYPES.includes(u.membershipType)?u.membershipType:'FREE',status:u.membershipStatus==='EXPIRED'?'EXPIRED':'ACTIVE',start:u.membershipStartDate||null,expire:u.membershipExpireDate||null};
}
// HAQIQIY (amaldagi) tarif: saqlangan holatga emas, joriy vaqtga qarab hisoblanadi.
function effectiveType(u){
  const m=membershipOf(u);
  return m.type!=='FREE'&&m.status==='ACTIVE'&&m.expire&&Date.parse(m.expire)>Date.now()?m.type:'FREE';
}
// Muddati o‘tgan bo‘lsa yozuvni EXPIRED + FREE holatiga o‘tkazadi. O‘zgargan bo‘lsa true (chaqiruvchi save qiladi).
function syncMembership(u){
  if(!u||membershipOf(u).type==='FREE'||effectiveType(u)!=='FREE')return false;
  const prev=u.membershipType;
  u.membershipType='FREE';u.membershipStatus='EXPIRED';
  (u.membershipHistory||=[]).push({id:id('mh'),action:'expired',type:prev,expireDate:u.membershipExpireDate,at:now()});
  return true;
}
function sweepMemberships(d){let n=0;for(const u of d.users)if(syncMembership(u))n++;if(n)save(d);return n;}
function ensureMembershipFields(d){for(const u of d.users){for(const k of Object.keys(MEMBERSHIP_DEFAULTS))if(u[k]===undefined)u[k]=MEMBERSHIP_DEFAULTS[k];}}
function membershipView(u){
  const m=membershipOf(u),type=effectiveType(u),active=type!=='FREE';
  return {type,label:MEMBERSHIP_LABELS[type],icon:MEMBERSHIP_ICONS[type],status:active?'ACTIVE':(m.status==='EXPIRED'?'EXPIRED':'ACTIVE'),active,startDate:m.start,expireDate:m.expire,daysLeft:active?Math.ceil((Date.parse(m.expire)-Date.now())/86400000):0,features:PLAN_FEATURES[type].slice()};
}
// ---- Yagona ruxsat tizimi ----
// hasAccess(user,'premium_tests') — barcha himoyalangan kontent shu funksiya orqali tekshiriladi.
function hasAccess(u,feature){
  if(!u||!FEATURES.includes(feature))return false; // noma’lum ruxsat nomi — rad etiladi
  if(STAFF_BYPASS.includes(u.role))return true;
  return PLAN_FEATURES[effectiveType(u)].includes(feature);
}
const minPlanFor=feature=>MEMBERSHIP_TYPES.find(t=>PLAN_FEATURES[t].includes(feature))||null;
function denyAccess(res,feature){
  const need=minPlanFor(feature);
  return json(res,403,{code:'MEMBERSHIP_REQUIRED',error:need?`Bu material VIP a'zolikni talab qiladi. Kerakli tarif: ${MEMBERSHIP_LABELS[need]} yoki undan yuqori.`:'Bu kontentga ruxsat yo‘q',requiredFeature:feature,requiredFeatureLabel:FEATURE_LABELS[feature]||feature,requiredPlan:need,requiredPlanLabel:need?MEMBERSHIP_LABELS[need]:null});
}
// Endpoint ichida: const u=requireAccess(req,res,d,'premium_lessons'); if(!u)return;
function requireAccess(req,res,d,feature){
  const u=requireUser(req,res,d);if(!u)return null;
  if(hasAccess(u,feature))return u;
  denyAccess(res,feature);return null;
}
// Test qaysi ruxsatni talab qiladi? (null = bepul). `requiredFeature` maydoni testda qo‘lda berilishi ham mumkin.
function testFeature(t){
  if(t.requiredFeature&&FEATURES.includes(t.requiredFeature))return t.requiredFeature;
  if((t.access||'free')==='free')return null;
  return t.category==='speaking'?'speaking':t.category==='writing'?'writing':'premium_tests';
}
const testAccess=(u,t)=>{const f=testFeature(t);return !f||hasAccess(u,f);};
function testAccessInfo(u,t){
  const f=testFeature(t),ok=!f||hasAccess(u,f),need=f&&!ok?minPlanFor(f):null;
  return {...t,locked:!ok,requiredFeature:f,requiredFeatureLabel:f?(FEATURE_LABELS[f]||f):null,requiredPlan:need,requiredPlanLabel:need?MEMBERSHIP_LABELS[need]:null};
}
// Admin tomonidan tarifni faollashtirish. Foydalanuvchida bitta yozuv bor, shuning uchun dublikat bo‘lmaydi:
//  - bir xil tarif faol bo‘lsa: muddat amaldagi tugash sanasiga QO‘SHILADI
//  - boshqa tarif faol bo‘lsa: faqat replace=true bilan almashtiriladi (qolgan muddat yo‘qoladi)
function activateMembership(u,type,durKey,adminId,replace){
  syncMembership(u);
  const cur=effectiveType(u),ts=new Date();
  let start,expire,action;
  if(cur===type){start=u.membershipStartDate;expire=addDuration(u.membershipExpireDate,durKey);action='extended';}
  else if(cur!=='FREE'&&!replace)return {conflict:true,current:cur};
  else{start=ts.toISOString();expire=addDuration(ts,durKey);action=cur==='FREE'?'activated':'replaced';}
  Object.assign(u,{membershipType:type,membershipStatus:'ACTIVE',membershipStartDate:start,membershipExpireDate:expire.toISOString(),updatedAt:ts.toISOString()});
  (u.membershipHistory||=[]).push({id:id('mh'),action,type,duration:durKey,previousType:cur,startDate:start,expireDate:u.membershipExpireDate,byAdmin:adminId,at:ts.toISOString()});
  return {action};
}
function revokeMembership(u,adminId){
  const prev=effectiveType(u),ts=now();
  Object.assign(u,{membershipType:'FREE',membershipStatus:'EXPIRED',membershipExpireDate:ts,updatedAt:ts});
  (u.membershipHistory||=[]).push({id:id('mh'),action:'revoked',type:prev,byAdmin:adminId,at:ts});
}

// ---- VIP sahifasi va admin boshqaruvi uchun ma’lumotlar ----
// Ruxsat mantig‘i FAQAT yuqoridagi TIER_FEATURES da. Quyidagilar shundan hisoblanadi, frontendda takrorlanmaydi.
// Yangi VIP imkoniyat qo‘shish: 1) TIER_FEATURES ga nom qo‘shing, 2) FEATURE_LABELS ga matn, 3) kerak bo‘lsa COMPARISON_ROWS ga qator.
const PLAN_INFO={
  SILVER:{description:'Premium darslar, qo‘shimcha mashqlar va natijalar tarixi bilan o‘qishni boshlash uchun.'},
  GOLD:{description:'Barcha premium darslar, Multilevel, Speaking va Writing mashqlari — jiddiy tayyorgarlik uchun.'},
  PLATINUM:{description:'Barcha materiallar, Reading va Listening, reklamasiz tajriba va kelajakdagi yangi kontent.'}
};
// Taqqoslash jadvali qatori: full — to‘liq ruxsat, limited — qisman (tanlangan) ruxsat, free — FREE tarifdagi holat.
const COMPARISON_ROWS=[
  {key:'lessons',label:'Lessons',free:'limited',limited:'premium_lesson',full:'all_lessons'},
  {key:'practice_tests',label:'Practice Tests',free:'limited',limited:['premium_tests','advanced_tests'],full:'all_tests'},
  {key:'multilevel_tests',label:'Multilevel Tests',full:'multilevel_tests'},
  {key:'speaking',label:'Speaking',full:'speaking'},
  {key:'writing',label:'Writing',full:'writing'},
  {key:'reading',label:'Reading',full:'reading_materials'},
  {key:'listening',label:'Listening',full:'listening_materials'},
  {key:'grammar',label:'Grammar',limited:'grammar',full:'advanced_grammar'},
  {key:'vocabulary',label:'Vocabulary',limited:'vocabulary',full:'advanced_vocabulary'},
  {key:'advanced_materials',label:'Advanced Materials',full:'extra_materials'},
  {key:'ad_free',label:'Ad-free',full:'ad_free'},
  {key:'vip_badge',label:'VIP Badge',full:'vip_badge'},
  {key:'platinum_content',label:'Platinum Content',full:'platinum_content'}
];
function comparisonTable(){
  const list=v=>v===undefined?[]:[].concat(v);
  return COMPARISON_ROWS.map(r=>({key:r.key,label:r.label,cells:Object.fromEntries(MEMBERSHIP_TYPES.map(t=>{
    const has=x=>list(x).some(f=>PLAN_FEATURES[t].includes(f));
    return [t,has(r.full)?'full':has(r.limited)?'limited':((t==='FREE'&&r.free)||'none')];
  }))}));
}
// Admin: joriy tarif darajasini o‘zgartirish. Boshlanish va tugash sanalari O‘ZGARMAYDI (qolgan muddat saqlanadi).
function changeMembershipType(u,type,adminId){
  syncMembership(u);
  const cur=effectiveType(u);
  if(cur==='FREE')return {status:409,error:'Foydalanuvchida faol VIP a‘zolik yo‘q. Avval VIP ni faollashtiring.'};
  if(cur===type)return {status:400,error:'Foydalanuvchida allaqachon shu tarif faol'};
  const ts=now();
  u.membershipType=type;u.updatedAt=ts;
  (u.membershipHistory||=[]).push({id:id('mh'),action:'changed',type,previousType:cur,startDate:u.membershipStartDate,expireDate:u.membershipExpireDate,byAdmin:adminId,at:ts});
  return {action:'changed'};
}
// A‘zolik tarixi: har bir foydalanuvchining saqlangan voqealaridan o‘qiladigan yozuvlar. Hech narsa o‘chirilmaydi.
// Holat (status) voqealar ketma-ketligidan hisoblanadi: ACTIVE / EXPIRED / REVOKED / EXTENDED / REPLACED / CHANGED.
const HISTORY_ACTIONS={activated:'Faollashtirildi',extended:'Uzaytirildi',replaced:'Tarif almashtirildi',changed:'Daraja o‘zgartirildi'};
const HISTORY_SUPERSEDED={extended:'EXTENDED',replaced:'REPLACED',changed:'CHANGED'};
function membershipRecords(d,userId){
  const byId=new Map(d.users.map(x=>[x.id,x])),out=[];
  for(const u of d.users){
    if(userId&&u.id!==userId)continue;
    let open=null;
    for(const h of (u.membershipHistory||[])){
      if(HISTORY_ACTIONS[h.action]){
        if(open)open.status=HISTORY_SUPERSEDED[h.action]||'REPLACED';
        const adm=byId.get(h.byAdmin),dur=h.duration&&MEMBERSHIP_DURATIONS[h.duration];
        open={id:h.id,userId:u.id,userName:u.name,userEmail:u.email,plan:h.type,planLabel:MEMBERSHIP_LABELS[h.type]||h.type,icon:MEMBERSHIP_ICONS[h.type]||'',
          action:h.action,actionLabel:HISTORY_ACTIONS[h.action],duration:h.duration||null,durationLabel:dur?dur.label:null,
          startDate:h.startDate||null,expireDate:h.expireDate||null,activatedBy:h.byAdmin||null,activatedByName:adm?adm.name:'—',at:h.at,status:'ACTIVE'};
        out.push(open);
      }else if(h.action==='expired'&&open){open.status='EXPIRED';open=null;}
      else if(h.action==='revoked'&&open){open.status='REVOKED';open=null;}
    }
    if(open&&effectiveType(u)==='FREE')open.status='EXPIRED';
  }
  return out.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
}

// Multilevel CEFR qoidasi (Overall Score, butun sonlar). 40 dan past — daraja berilmaydi.
const CEFR_RULES=[{min:61,max:null,level:'C1'},{min:50,max:60,level:'B2'},{min:40,max:49,level:'B1'}];
const LEVEL_NONE='Level not assigned';
function cefrLevel(score){const v=Math.floor(Number(score));if(!Number.isFinite(v))return null;const r=CEFR_RULES.find(x=>v>=x.min&&(x.max===null||v<=x.max));return r?r.level:null;}
function levelFor(d,testId,score){if(score===null||score===undefined)return null;const t=d.tests.find(x=>x.id===testId);return t&&t.category==='multilevel'?cefrLevel(score):level(score,d.settings.thresholds);}
function level(score,t){return Object.entries(t).sort((a,b)=>b[1]-a[1]).find(([,v])=>score>=v)?.[0]||'A1';}
function requireRole(req,res,d,roles){const u=requireUser(req,res,d);if(!u)return null;if(!roles.includes(u.role)){json(res,403,{error:'Bu amal uchun ruxsatingiz yo‘q'});return null;}return u;}
function isObjective(q){return ['single','multiple','true_false','gap','text','matching','ordering'].includes(q.type);}
function correctAnswer(q,a){if(!a)return false;if(q.type==='single'||q.type==='true_false')return Number(a.answer)===Number(q.correct);if(q.type==='multiple')return JSON.stringify([].concat(a.answer).map(Number).sort())===JSON.stringify([].concat(q.correct).map(Number).sort());if(q.type==='gap'||q.type==='text')return String(a.answer||'').trim().toLowerCase()===String(q.correct||'').trim().toLowerCase();return false;}
function issueCertificate(d,a){if(d.certificates.find(c=>c.attemptId===a.id))return;const code='CERT-'+crypto.randomBytes(4).toString('hex').toUpperCase();d.certificates.push({id:id('cert'),attemptId:a.id,code,issuedAt:now()});}
function recalculateAttempt(d,a){
  const test=d.tests.find(t=>t.id===a.testId),qs=d.questions.filter(q=>q.testId===a.testId),answers=d.answers.filter(x=>x.attemptId===a.id),manual=['writing','speaking'];
  const moduleScores={}; let complete=true;
  for(const module of test.modules){const mqs=qs.filter(q=>q.module===module), objective=mqs.filter(isObjective), evs=d.evaluations.filter(e=>e.attemptId===a.id&&mqs.some(q=>q.id===e.questionId));
    if(mqs.some(q=>manual.includes(q.type)&&hasAnswer(answers.find(x=>x.questionId===q.id))&&!evs.some(e=>e.questionId===q.id))){moduleScores[module]=null;complete=false;continue;} // hali baholanmagan yozma/og'zaki javob bor
    if(evs.length){moduleScores[module]=Math.round(evs.reduce((s,e)=>s+Number(e.overall),0)/evs.length);continue;}
    if(objective.length){const earned=objective.reduce((s,q)=>s+(correctAnswer(q,answers.find(x=>x.questionId===q.id))?(q.points||1):0),0), max=objective.reduce((s,q)=>s+(q.points||1),0);moduleScores[module]=max?Math.round(earned/max*100):0;continue;}
    if(mqs.some(q=>manual.includes(q.type)&&hasAnswer(answers.find(a2=>a2.questionId===q.id)))) {moduleScores[module]=null;complete=false;continue;}
    moduleScores[module]=0;
  }
  const scores=Object.values(moduleScores).filter(v=>typeof v==='number');a.moduleScores=moduleScores;a.objectiveScore=scores.length?Math.round(scores.reduce((s,v)=>s+v,0)/scores.length):0;a.score=complete&&scores.length?Math.round(scores.reduce((s,v)=>s+v,0)/scores.length):null;a.pendingReview=!complete;
  const sub=(d.submissions||[]).find(x=>x.attemptId===a.id);
  if(sub&&sub.result){const r=sub.result;a.moduleScores={listening:r.listening,reading:r.reading,writing:r.writing,speaking:r.speaking};a.score=r.overall;a.pendingReview=false;} // admin kiritgan ballar hisoblanganlardan ustun
  return a;
}
function isReadyAttempt(d,a){const sub=(d.submissions||[]).find(x=>x.attemptId===a.id);return !sub||sub.status==='ready';}
function attemptView(d,a){const test=d.tests.find(t=>t.id===a.testId),hide=a.status==='completed'&&!isReadyAttempt(d,a),base=hide?{...a,score:null,objectiveScore:null,moduleScores:{}}:a;return {...base,test,level:base.score===null?null:levelFor(d,a.testId,base.score),levelLabel:base.score===null?null:(levelFor(d,a.testId,base.score)||LEVEL_NONE),certificate:hide?null:d.certificates.find(c=>c.attemptId===a.id)||null};}

function hasAnswer(x){if(!x)return false;const v=x.answer;if(v===undefined||v===null)return false;if(typeof v==='string')return v.trim().length>0;if(Array.isArray(v))return v.length>0;if(typeof v==='object')return v.fileName!==undefined?!!v.fileName:Object.keys(v).length>0;return true;}
function normalizeCategory(c){c=String(c||'').toLowerCase();return SUBMISSION_CATEGORIES.includes(c)?c:'multilevel';}
// Yozma/og'zaki topshiriqlar: jami javob berilgan, baholangan, kutilayotgan
function manualStats(d,a){const qs=d.questions.filter(q=>q.testId===a.testId&&['writing','speaking'].includes(q.type)),answered=qs.filter(q=>hasAnswer(d.answers.find(x=>x.attemptId===a.id&&x.questionId===q.id))),evaluated=answered.filter(q=>d.evaluations.some(e=>e.attemptId===a.id&&e.questionId===q.id));return {total:answered.length,evaluated:evaluated.length,pending:answered.length-evaluated.length};}
// Holatni doim javoblar va baholardan qayta hisoblaydi (bitta manba)
function syncSubmission(d,a,opts={}){
  const s=d.submissions.find(x=>x.attemptId===a.id);if(!s)return null;
  const m=manualStats(d,a),ml=s.category==='multilevel';
  if(opts.reviewerId&&(m.pending>0||(ml&&!s.finalizedAt))&&!s.reviewStartedAt){s.reviewStartedAt=now();s.reviewerId=opts.reviewerId;}
  // Multilevel: admin "Natijani saqlash" tugmasini bosmaguncha (finalizedAt) hech qachon 'ready' bo'lmaydi.
  // Boshqa kategoriyalar: barcha qo'lda tekshiriladigan topshiriqlar baholansa avtomatik 'ready'.
  const done=ml?(!!s.finalizedAt&&(m.pending===0||!!s.result)):(m.total===0||m.pending===0);
  s.status=done?'ready':(m.evaluated>0||s.reviewStartedAt)?'in_review':'pending_admin';
  s.score=s.status==='ready'&&typeof a.score==='number'?a.score:null;
  s.readyAt=s.status==='ready'?(s.readyAt||now()):null;
  s.updatedAt=now();
  if(s.status==='ready'&&typeof a.score==='number'&&(s.category!=='multilevel'||cefrLevel(a.score)))issueCertificate(d,a); // sertifikat faqat natija tayyor bo'lgach
  return s;
}
// BITTA yakunlangan urinish = BITTA topshiriq. attemptId bo'yicha unikal: ikkinchi chaqiruv mavjudini qaytaradi.
function createSubmission(d,a){
  const existing=d.submissions.find(x=>x.attemptId===a.id);if(existing)return {submission:existing,created:false};
  const test=d.tests.find(t=>t.id===a.testId);
  const s={id:id('sub'),attemptId:a.id,userId:a.userId,testId:a.testId,testTitle:test?.title||a.testId,category:normalizeCategory(test?.category),status:'pending_admin',submittedAt:a.completedAt||now(),reviewStartedAt:null,reviewerId:null,readyAt:null,score:null};
  d.submissions.push(s);a.submissionId=s.id;syncSubmission(d,a);return {submission:s,created:true};
}
// Eski ma'lumotlar uchun: yakunlangan (javobi bor) har bir urinishga bittadan topshiriq. Qayta ishga tushirish xavfsiz (idempotent).
function backfillSubmissions(d){
  d.submissions||=[];let changed=false;const seen=new Set(),before=d.submissions.length;
  d.submissions=d.submissions.filter(x=>!seen.has(x.attemptId)&&seen.add(x.attemptId));if(d.submissions.length!==before)changed=true;
  for(const x of d.submissions){if(x.category==='multilevel'&&x.status==='ready'&&!x.finalizedAt){x.finalizedAt=x.readyAt||now();changed=true;}} // eski tayyor natijalar o'zgarmaydi
  for(const a of d.attempts||[]){
    if(a.status!=='completed'||seen.has(a.id))continue;
    if(!d.answers.some(x=>x.attemptId===a.id))continue;                 // javobsiz (tasodifiy) urinishlar topshiriq bo'lmaydi
    if(!d.tests.some(t=>t.id===a.testId))continue;                       // test bazada yo'q (darsliklar arxivda) — keyin qaytadan urinadi
    if(!!a.pendingReview!==(manualStats(d,a).pending>0))recalculateAttempt(d,a); // eski hisob-kitobdagi noto'g'ri 'pending' holatini tuzatish
    createSubmission(d,a);seen.add(a.id);changed=true;
  }
  return changed;
}
function submissionView(d,s,full=false){
  const a=d.attempts.find(x=>x.id===s.attemptId),u=d.users.find(x=>x.id===s.userId),t=d.tests.find(x=>x.id===s.testId),m=a?manualStats(d,a):{total:0,pending:0,evaluated:0},ready=s.status==='ready';
  const hasScore=ready&&typeof s.score==='number',lv=hasScore?(s.result&&s.result.level!==undefined?s.result.level:levelFor(d,s.testId,s.score)):null,ms=(full||ready)?(s.result?{listening:s.result.listening,reading:s.result.reading,writing:s.result.writing,speaking:s.result.speaking}:(a?.moduleScores||{})):{};
  return {id:s.id,attemptId:s.attemptId,userId:s.userId,userName:u?.name||'—',testId:s.testId,testTitle:t?.title||s.testTitle,category:s.category,categoryLabel:CATEGORY_LABELS[s.category],submittedAt:s.submittedAt,status:s.status,statusLabel:SUBMISSION_STATUS[s.status],score:hasScore?s.score:null,level:hasScore?lv:null,levelLabel:hasScore?(lv||LEVEL_NONE):null,issuedAt:ready&&s.result?s.result.issuedAt:null,checkedAt:ready&&s.result?s.result.checkedAt:null,moduleScores:ms,modules:ready?{listening:ms.listening??null,reading:ms.reading??null,writing:ms.writing??null,speaking:ms.speaking??null}:null,certificate:ready?(d.certificates.find(c=>c.attemptId===s.attemptId)||null):null,totalTasks:m.total,evaluatedTasks:m.evaluated,pendingTasks:s.result?0:m.pending,reviewStartedAt:s.reviewStartedAt||null,readyAt:ready?(s.readyAt||null):null};
}
function submissionDetail(d,s){
  const a=d.attempts.find(x=>x.id===s.attemptId),u=d.users.find(x=>x.id===s.userId);
  const tasks=d.questions.filter(q=>q.testId===s.testId&&['writing','speaking'].includes(q.type)).map(q=>({q,ans:d.answers.find(x=>x.attemptId===s.attemptId&&x.questionId===q.id)})).filter(x=>hasAnswer(x.ans)).map(({q,ans})=>({question:{id:q.id,type:q.type,module:q.module,text:q.text},answer:ans.answer,evaluation:d.evaluations.find(e=>e.attemptId===s.attemptId&&e.questionId===q.id)||null}));
  return {submission:submissionView(d,s,true),student:u?{id:u.id,name:u.name,email:u.email}:null,tasks,attempt:a?{id:a.id,startedAt:a.startedAt,completedAt:a.completedAt}:null,
    candidate:{...nameParts(u),foreignLanguage:'Ingliz tili',email:u?.email||'',issueDate:s.result?.issuedAt||now(),checkDate:s.result?.checkedAt||now()},
    result:s.result?{listening:s.result.listening,reading:s.result.reading,writing:s.result.writing,speaking:s.result.speaking,overall:s.result.overall,level:s.result.level??null,levelLabel:s.result.level||LEVEL_NONE,issuedAt:s.result.issuedAt,checkedAt:s.result.checkedAt,savedAt:s.result.savedAt}:null,
    suggested:suggestedScores(a),levelRules:CEFR_RULES,levelNone:LEVEL_NONE};
}
// Nomzod ismi hisobdan olinadi: alohida firstName/lastName bo'lsa ular, aks holda "Ism Familiya" ni ajratadi.
function nameParts(u){if(!u)return {surname:'',firstName:''};if(u.firstName||u.lastName)return {surname:u.lastName||'',firstName:u.firstName||''};const p=String(u.name||'').trim().split(/\s+/).filter(Boolean);return p.length<2?{surname:'',firstName:p[0]||''}:{surname:p.slice(1).join(' '),firstName:p[0]};}
// Admin uchun taklif: avtomatik hisoblangan modul ballari (baholanmaganlari null)
function suggestedScores(a){const ms=a?.moduleScores||{},o={listening:ms.listening??null,reading:ms.reading??null,writing:ms.writing??null,speaking:ms.speaking??null},v=Object.values(o);o.overall=v.every(x=>typeof x==='number')?Math.round(v.reduce((p,c)=>p+c,0)/v.length):null;return o;}

// ---- Static files: in-memory cache, ETag/304, gzip, bundled CSS/JS ----
const PUBLIC=path.join(ROOT,'public');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json','.woff2':'font/woff2'};
const BUNDLES={'/bundle.css':['style.css','modules.css','glass.css','menu.css','fixes.css','vip.css'],'/bundle.js':['perf-shim.js','vip.js','app.js','enhance.js','fixes.js']};
const fileCache=new Map();
function minifyCss(c){return c.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,' ').replace(/\s*([{};,>])\s*/g,'$1').replace(/;}/g,'}').trim();}
function buildEntry(key,names,ext){
  let sig='',parts=[];
  for(const n of names){const f=path.join(PUBLIC,n);if(!fs.existsSync(f))continue;sig+=n+fs.statSync(f).mtimeMs+';';let t=fs.readFileSync(f,'utf8');parts.push(ext==='.css'?minifyCss(t):t);}
  return {sig,raw:Buffer.from(parts.join(ext==='.css'?'\n':'\n;\n'))};
}
function getStatic(key){
  const bundle=BUNDLES[key],cached=fileCache.get(key);
  let sig,raw;
  if(bundle){
    const cur=bundle.map(n=>{const f=path.join(PUBLIC,n);return fs.existsSync(f)?n+fs.statSync(f).mtimeMs+';':'';}).join('');
    if(cached&&cached.sig===cur)return cached;
    const b=buildEntry(key,bundle,path.extname(key));sig=b.sig;raw=b.raw;
  }else{
    const f=path.normalize(path.join(PUBLIC,key));
    if(!f.startsWith(PUBLIC+path.sep)&&f!==PUBLIC)return null;
    let st;try{st=fs.statSync(f);}catch{return null;}
    if(!st.isFile())return null;
    sig=String(st.mtimeMs);
    if(cached&&cached.sig===sig)return cached;
    raw=fs.readFileSync(f);
  }
  const ext=path.extname(key),type=MIME[ext]||'application/octet-stream';
  const gz=/^(\.html|\.css|\.js|\.svg|\.json)$/.test(ext)&&raw.length>512?zlib.gzipSync(raw,{level:9}):null;
  const entry={sig,raw,gz,type,etag:'"'+crypto.createHash('sha1').update(raw).digest('hex').slice(0,20)+'"'};
  fileCache.set(key,entry);return entry;
}
function serveStatic(req,res,p){
  let key=p==='/'?'/index.html':p,e=getStatic(key);
  if(!e&&!path.extname(key)){key='/index.html';e=getStatic(key);}   // SPA fallback (only for extension-less routes)
  if(!e){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');}
  const h={'Content-Type':e.type,'ETag':e.etag,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding'};
  if(req.headers['if-none-match']===e.etag){res.writeHead(304,h);return res.end();}
  const useGz=e.gz&&/\bgzip\b/.test(req.headers['accept-encoding']||''),body=useGz?e.gz:e.raw;
  if(useGz)h['Content-Encoding']='gzip';
  h['Content-Length']=body.length;res.writeHead(200,h);return req.method==='HEAD'?res.end():res.end(body);
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`); const p=url.pathname; if(p==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok');} const d=p.startsWith('/api/')?load():null;
  try {
    if(p.startsWith('/api/'))res.setHeader('X-Robots-Tag','noindex, nofollow');
    if(p.startsWith('/api/')) {
      if(req.method==='POST'&&(p==='/api/auth/login'||p==='/api/auth/admin-login')){const b=await body(req);const keys=loginKeys(req,b.identifier),wait=loginLocked(keys);if(wait)return json(res,429,{error:'Juda ko‘p noto‘g‘ri urinish. '+wait+' daqiqadan keyin qayta urinib ko‘ring'});const u=d.users.find(x=>(x.email===b.identifier||x.phone===b.identifier)&&x.status==='active');if(!u||!validPassword(b.password||'',u.password)){loginFail(keys);return json(res,401,{error:'Email/telefon yoki parol noto‘g‘ri'});}if(p==='/api/auth/admin-login'&&!['admin','super_admin','examiner','moderator'].includes(u.role))return json(res,403,{error:'Bu hisob administrator paneliga kira olmaydi'});loginOk(keys);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{userId:u.id});return json(res,200,{token,user:publicUser(u)});}
      if(req.method==='POST'&&p==='/api/auth/register'){const b=await body(req);if(!b.name||!b.email||!b.password||b.password.length<8)return json(res,400,{error:'Ism, email va kamida 8 belgili parol talab qilinadi'});if(d.users.some(x=>x.email===b.email))return json(res,409,{error:'Bu email allaqachon ro‘yxatdan o‘tgan'});const u={id:id('u'),name:b.name,email:b.email,phone:b.phone||'',region:b.region||'',role:'student',password:hash(b.password),status:'active',createdAt:now(),...MEMBERSHIP_DEFAULTS};d.users.push(u);save(d);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{userId:u.id});return json(res,201,{token,user:publicUser(u)});}
      if(req.method==='POST'&&p==='/api/auth/logout'){sessions.delete((req.headers.authorization||'').replace('Bearer ',''));return json(res,200,{ok:true});}
      if(req.method==='GET'&&p==='/api/me'){const u=requireUser(req,res,d);if(u)json(res,200,{user:publicUser(u)});return;}
      if(req.method==='PUT'&&p==='/api/me'){const u=requireUser(req,res,d);if(!u)return;const b=await body(req);const name=String(b.name||'').trim(),phone=String(b.phone||'').trim(),region=String(b.region||'').trim();if(name.length<3||name.length>80)return json(res,400,{error:'To‘liq ism 3–80 belgi oralig‘ida bo‘lishi kerak'});u.name=name;u.phone=phone;u.region=region;u.updatedAt=now();save(d);return json(res,200,{user:publicUser(u)});}
      if(req.method==='PUT'&&p==='/api/me/password'){const u=requireUser(req,res,d);if(!u)return;const b=await body(req);if(!validPassword(b.currentPassword||'',u.password))return json(res,400,{error:'Joriy parol noto‘g‘ri'});if(!b.newPassword||b.newPassword.length<8)return json(res,400,{error:'Yangi parol kamida 8 belgidan iborat bo‘lsin'});u.password=hash(b.newPassword);u.updatedAt=now();save(d);return json(res,200,{ok:true});}
      if(req.method==='GET'&&p==='/api/dashboard'){const u=requireUser(req,res,d);if(!u)return;const all=d.attempts.filter(a=>a.userId===u.id),completed=all.filter(a=>a.status==='completed'),scored=completed.filter(a=>typeof a.score==='number'&&isReadyAttempt(d,a));const scores=scored.map(a=>a.score);return json(res,200,{started:all.filter(a=>a.status==='in_progress').length,completed:completed.length,average:scores.length?Math.round(scores.reduce((s,v)=>s+v,0)/scores.length):0,best:scores.length?Math.max(...scores):0,recent:all.sort((a,b)=>new Date(b.updatedAt||b.completedAt)-new Date(a.updatedAt||a.completedAt)).slice(0,5).map(a=>attemptView(d,a))});}
      if(req.method==='GET'&&p==='/api/public/stats')return json(res,200,{users:d.users.filter(u=>u.role==='student').length,completed:d.attempts.filter(a=>a.status==='completed').length,tests:d.tests.filter(t=>t.status==='published').length,certificates:d.certificates.length});
      if(req.method==='GET'&&p==='/api/support/config')return json(res,200,{telegram:d.settings.supportTelegram||'@onlytowinn'});
      if(req.method==='POST'&&p==='/api/support/tickets'){const b=await body(req),name=String(b.name||'').trim(),contact=String(b.contact||'').trim(),message=String(b.message||'').trim();if(name.length<2||contact.length<3||message.length<10)return json(res,400,{error:'Ism, aloqa va kamida 10 belgili murojaat talab qilinadi'});d.supportTickets.push({id:id('ticket'),name,contact,message,status:'open',createdAt:now(),userId:user(req,d)?.id||null});save(d);return json(res,201,{ticket:{id:d.supportTickets.at(-1).id,status:'open'},telegram:d.settings.supportTelegram||'@onlytowinn'});}
      if(req.method==='GET'&&p==='/api/tests'){const u=user(req,d);return json(res,200,{tests:(u&&['admin','super_admin'].includes(u.role)?d.tests:d.tests.filter(t=>t.status==='published')).map(t=>testAccessInfo(u,t))});}
      const m=p.match(/^\/api\/tests\/([^/]+)$/); if(req.method==='GET'&&m){const t=d.tests.find(x=>x.id===m[1]);if(!t)return json(res,404,{error:'Test topilmadi'});{const u=user(req,d);if(!testAccess(u,t))return u?denyAccess(res,testFeature(t)):json(res,401,{error:'Avval tizimga kiring'});}return json(res,200,{test:t,questions:d.questions.filter(q=>q.testId===t.id).map(({correct,...q})=>q)});}
      if(req.method==='POST'&&p==='/api/attempts'){const u=requireUser(req,res,d);if(!u)return;const b=await body(req),t=d.tests.find(x=>x.id===b.testId);if(!t)return json(res,404,{error:'Test topilmadi'});if(!testAccess(u,t))return denyAccess(res,testFeature(t));let a=d.attempts.find(x=>x.userId===u.id&&x.testId===t.id&&x.status==='in_progress');if(!a&&BLOCK_RETAKE_WHILE_PENDING){const open=d.submissions.find(x=>x.userId===u.id&&x.testId===t.id&&x.status!=='ready');if(open)return json(res,409,{code:'SUBMISSION_PENDING',error:'Bu test allaqachon topshirilgan. Natija tayyor bo‘lgach qayta topshirishingiz mumkin.',submissionId:open.id});}if(!a){a={id:id('a'),userId:u.id,testId:t.id,status:'in_progress',startedAt:now(),updatedAt:now()};d.attempts.push(a);save(d);}return json(res,200,{attempt:a,answers:d.answers.filter(x=>x.attemptId===a.id)});}
      const getAttempt=p.match(/^\/api\/attempts\/([^/]+)$/);if(req.method==='GET'&&getAttempt){const u=requireUser(req,res,d);if(!u)return;const a=d.attempts.find(x=>x.id===getAttempt[1]&&x.userId===u.id);if(!a)return json(res,404,{error:'Urinish topilmadi'});return json(res,200,{attempt:attemptView(d,a),answers:d.answers.filter(x=>x.attemptId===a.id)});}
      const am=p.match(/^\/api\/attempts\/([^/]+)\/answer$/);if(req.method==='POST'&&am){const u=requireUser(req,res,d);if(!u)return;const b=await body(req),a=d.attempts.find(x=>x.id===am[1]&&x.userId===u.id);if(!a)return json(res,404,{error:'Urinish topilmadi'});if(a.status!=='in_progress')return json(res,200,{ok:true,ignored:true});let ans=d.answers.find(x=>x.attemptId===a.id&&x.questionId===b.questionId);if(ans)ans.answer=b.answer;else d.answers.push({id:id('ans'),attemptId:a.id,questionId:b.questionId,answer:b.answer,updatedAt:now()});a.updatedAt=now();save(d);return json(res,200,{ok:true});}
      const audio=p.match(/^\/api\/attempts\/([^/]+)\/audio$/);if(req.method==='POST'&&audio){const u=requireUser(req,res,d);if(!u)return;const b=await body(req),a=d.attempts.find(x=>x.id===audio[1]&&x.userId===u.id),q=d.questions.find(x=>x.id===b.questionId&&x.testId===a?.testId);if(!a||!q||q.type!=='speaking')return json(res,400,{error:'Audio topshirig‘i topilmadi'});if(a.status!=='in_progress')return json(res,409,{code:'ALREADY_SUBMITTED',error:'Test allaqachon topshirilgan'});if(!['audio/webm','audio/wav','audio/ogg','audio/mp4'].includes(b.mime)||typeof b.data!=='string')return json(res,400,{error:'Faqat WebM, WAV, OGG yoki MP4 audio ruxsat etiladi'});const buffer=Buffer.from(b.data,'base64');if(!buffer.length||buffer.length>10*1024*1024)return json(res,400,{error:'Audio fayl 10 MB dan kichik bo‘lishi kerak'});if(!fs.existsSync(UPLOADS))fs.mkdirSync(UPLOADS,{recursive:true});const ext={"audio/webm":"webm","audio/wav":"wav","audio/ogg":"ogg","audio/mp4":"m4a"}[b.mime],file=`${id('audio')}.${ext}`;fs.writeFileSync(path.join(UPLOADS,file),buffer);let ans=d.answers.find(x=>x.attemptId===a.id&&x.questionId===q.id);const answer={fileName:file,mime:b.mime,duration:Number(b.duration)||0};if(ans)ans.answer=answer;else d.answers.push({id:id('ans'),attemptId:a.id,questionId:q.id,answer,updatedAt:now()});a.updatedAt=now();save(d);return json(res,201,{audio:{url:`/uploads/${file}`,duration:answer.duration}});}
      const fm=p.match(/^\/api\/attempts\/([^/]+)\/finish$/);if(req.method==='POST'&&fm){const u=requireUser(req,res,d);if(!u)return;const a=d.attempts.find(x=>x.id===fm[1]&&x.userId===u.id);if(!a)return json(res,404,{error:'Urinish topilmadi'});
        // Idempotent: allaqachon topshirilgan bo'lsa hech narsa o'zgarmaydi va yangi yozuv yaratilmaydi.
        if(a.status==='completed'){const s0=d.submissions.find(x=>x.attemptId===a.id);return json(res,200,{alreadySubmitted:true,attempt:attemptView(d,a),submission:s0?submissionView(d,s0):null,pending:!!a.pendingReview});}
        if(!d.answers.some(x=>x.attemptId===a.id&&hasAnswer(x)))return json(res,400,{code:'EMPTY_ATTEMPT',error:'Kamida bitta savolga javob bering, keyin testni yakunlang'});
        a.status='completed';a.completedAt=now();recalculateAttempt(d,a);const {submission,created}=createSubmission(d,a);save(d);return json(res,created?201:200,{alreadySubmitted:!created,attempt:attemptView(d,a),submission:submissionView(d,submission),pending:a.pendingReview});}
      if(req.method==='GET'&&p==='/api/submissions'){const u=requireUser(req,res,d);if(!u)return;const list=d.submissions.filter(x=>x.userId===u.id).sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt)).map(x=>submissionView(d,x)),categories={};SUBMISSION_CATEGORIES.forEach(c=>categories[c]=list.filter(x=>x.category===c));return json(res,200,{submissions:list,categories,order:SUBMISSION_CATEGORIES,labels:CATEGORY_LABELS});}
      if(req.method==='GET'&&p==='/api/admin/submissions'){const u=requireRole(req,res,d,['admin','super_admin','examiner']);if(!u)return;const cat=url.searchParams.get('category'),st=url.searchParams.get('status');let list=d.submissions.slice();if(cat&&SUBMISSION_CATEGORIES.includes(cat))list=list.filter(x=>x.category===cat);if(st&&SUBMISSION_STATUS[st])list=list.filter(x=>x.status===st);list.sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt));const all=d.submissions;return json(res,200,{submissions:list.map(x=>submissionView(d,x,true)),counts:{total:all.length,pending_admin:all.filter(x=>x.status==='pending_admin').length,in_review:all.filter(x=>x.status==='in_review').length,ready:all.filter(x=>x.status==='ready').length},labels:SUBMISSION_STATUS,categories:CATEGORY_LABELS});}
      const subRes=p.match(/^\/api\/admin\/submissions\/([^/]+)\/result$/);if(subRes&&req.method==='POST'){const u=requireRole(req,res,d,['admin','super_admin','examiner']);if(!u)return;const s=d.submissions.find(x=>x.id===subRes[1]);if(!s)return json(res,404,{error:'Topshiriq topilmadi'});if(s.category!=='multilevel')return json(res,400,{error:'Bu sahifa faqat Multilevel topshiriqlar uchun'});const a=d.attempts.find(x=>x.id===s.attemptId);if(!a)return json(res,404,{error:'Urinish topilmadi'});const b=await body(req),vals={},errs={};for(const k of ['listening','reading','writing','speaking','overall']){const raw=b[k];let n=NaN;if(typeof raw==='number')n=raw;else if(typeof raw==='string'&&/^\d+([.,]\d+)?$/.test(raw.trim()))n=Number(raw.trim().replace(',','.'));if(!Number.isFinite(n)||n<0||n>100)errs[k]='0–100 oralig‘ida son kiriting';else if(k==='overall'&&!Number.isInteger(n))errs[k]='Overall Score butun son bo‘lishi kerak';else vals[k]=Math.round(n*100)/100;}if(Object.keys(errs).length)return json(res,400,{error:'Ballar noto‘g‘ri kiritilgan',fields:errs});const ts=now();s.result={...vals,level:cefrLevel(vals.overall),issuedAt:s.result?.issuedAt||ts,checkedAt:ts,savedAt:ts,savedBy:u.id};if(!s.reviewStartedAt){s.reviewStartedAt=ts;s.reviewerId=u.id;}s.finalizedAt=s.finalizedAt||ts;s.finalizedBy=u.id;recalculateAttempt(d,a);syncSubmission(d,a,{reviewerId:u.id});save(d);return json(res,200,submissionDetail(d,s));}
      const subFin=p.match(/^\/api\/admin\/submissions\/([^/]+)\/finalize$/);if(subFin&&req.method==='POST'){const u=requireRole(req,res,d,['admin','super_admin','examiner']);if(!u)return;const s=d.submissions.find(x=>x.id===subFin[1]);if(!s)return json(res,404,{error:'Topshiriq topilmadi'});const a=d.attempts.find(x=>x.id===s.attemptId);if(!a)return json(res,404,{error:'Urinish topilmadi'});const m=manualStats(d,a);if(m.pending>0)return json(res,409,{code:'TASKS_PENDING',error:'Hali '+m.pending+' ta yozma/og‘zaki topshiriq baholanmagan'});recalculateAttempt(d,a);if(!s.reviewStartedAt){s.reviewStartedAt=now();s.reviewerId=u.id;}s.finalizedAt=s.finalizedAt||now();s.finalizedBy=u.id;syncSubmission(d,a,{reviewerId:u.id});save(d);return json(res,200,submissionDetail(d,s));}
      const subOne=p.match(/^\/api\/admin\/submissions\/([^/]+)(\/open)?$/);if(subOne&&(req.method==='GET'||(req.method==='POST'&&subOne[2]))){const u=requireRole(req,res,d,['admin','super_admin','examiner']);if(!u)return;const s=d.submissions.find(x=>x.id===subOne[1]);if(!s)return json(res,404,{error:'Topshiriq topilmadi'});if(req.method==='POST'){const a=d.attempts.find(x=>x.id===s.attemptId);if(a){syncSubmission(d,a,{reviewerId:u.id});save(d);}}return json(res,200,submissionDetail(d,s));}
      if(req.method==='GET'&&p==='/api/results'){const u=requireUser(req,res,d);if(!u)return;return json(res,200,{results:d.attempts.filter(a=>a.userId===u.id&&a.status==='completed').map(a=>attemptView(d,a))});}
      if(req.method==='GET'&&p==='/api/certificates'){const u=requireUser(req,res,d);if(!u)return;return json(res,200,{certificates:d.certificates.map(c=>({...c,attempt:d.attempts.find(a=>a.id===c.attemptId)})).filter(x=>x.attempt?.userId===u.id&&isReadyAttempt(d,x.attempt)).map(x=>({...x,attempt:attemptView(d,x.attempt)}))});}
      const publicCert=p.match(/^\/api\/certificate\/([A-Z0-9-]+)$/);if(req.method==='GET'&&publicCert){const c=d.certificates.find(x=>x.code===publicCert[1]);if(!c)return json(res,404,{valid:false,error:'Sertifikat topilmadi'});const a=d.attempts.find(x=>x.id===c.attemptId),u=d.users.find(x=>x.id===a.userId),t=d.tests.find(x=>x.id===a.testId);if(!isReadyAttempt(d,a))return json(res,404,{valid:false,error:'Sertifikat topilmadi'});return json(res,200,{valid:true,certificate:{code:c.code,issuedAt:c.issuedAt,student:u.name,exam:t.title,score:a.score,level:levelFor(d,a.testId,a.score),levelLabel:levelFor(d,a.testId,a.score)||LEVEL_NONE}});}
      if(req.method==='GET'&&p==='/api/admin/overview'){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const pending=type=>d.answers.filter(a=>d.questions.find(q=>q.id===a.questionId)?.type===type&&!d.evaluations.some(e=>e.attemptId===a.attemptId&&e.questionId===a.questionId));return json(res,200,{users:d.users.length,active:d.users.filter(x=>x.status==='active').length,attempts:d.attempts.length,submissions:{total:d.submissions.length,pending_admin:d.submissions.filter(x=>x.status==='pending_admin').length,in_review:d.submissions.filter(x=>x.status==='in_review').length,ready:d.submissions.filter(x=>x.status==='ready').length},pendingWriting:pending('writing').length,pendingSpeaking:pending('speaking').length,tests:d.tests.length});}
      if(req.method==='GET'&&p==='/api/admin/users'){const u=requireRole(req,res,d,['admin','super_admin','moderator']);if(!u)return;sweepMemberships(d);return json(res,200,{users:d.users.map(x=>({...publicUser(x),attempts:d.attempts.filter(a=>a.userId===x.id).length}))});}
      if(req.method==='GET'&&p==='/api/admin/support'){const u=requireRole(req,res,d,['admin','super_admin','moderator']);if(!u)return;return json(res,200,{tickets:d.supportTickets.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))});}
      const manageUser=p.match(/^\/api\/admin\/users\/([^/]+)$/);if(req.method==='PATCH'&&manageUser){const u=requireRole(req,res,d,['admin','super_admin','moderator']);if(!u)return;const b=await body(req),target=d.users.find(x=>x.id===manageUser[1]);if(!target)return json(res,404,{error:'Foydalanuvchi topilmadi'});if(['active','blocked'].includes(b.status))target.status=b.status;save(d);return json(res,200,{user:publicUser(target)});}
      const manageRole=p.match(/^\/api\/admin\/users\/([^/]+)\/role$/);if(req.method==='PATCH'&&manageRole){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const b=await body(req),target=d.users.find(x=>x.id===manageRole[1]),roles=['student','moderator','examiner','admin','super_admin'];if(!target)return json(res,404,{error:'Foydalanuvchi topilmadi'});if(!roles.includes(b.role))return json(res,400,{error:'Noto‘g‘ri rol'});if(target.id===u.id&&b.role!==u.role)return json(res,400,{error:'O‘zingizning admin rolingizni o‘zgartira olmaysiz'});target.role=b.role;target.updatedAt=now();save(d);return json(res,200,{user:publicUser(target)});}
      if(req.method==='GET'&&p==='/api/membership/plans')return json(res,200,{plans:MEMBERSHIP_TYPES.map((t,i)=>({type:t,label:MEMBERSHIP_LABELS[t],icon:MEMBERSHIP_ICONS[t],description:(PLAN_INFO[t]||{}).description||'',includes:MEMBERSHIP_TYPES.slice(1,i),features:PLAN_FEATURES[t],featureLabels:PLAN_FEATURES[t].map(f=>FEATURE_LABELS[f]||f),ownFeatures:(TIER_FEATURES[t]||[]),ownFeatureLabels:(TIER_FEATURES[t]||[]).map(f=>FEATURE_LABELS[f]||f)})),durations:Object.entries(MEMBERSHIP_DURATIONS).map(([key,v])=>({key,label:v.label})),comparison:comparisonTable(),contact:{telegram:(d.settings&&d.settings.supportTelegram)||''}});
      const memAdmin=p.match(/^\/api\/admin\/users\/([^/]+)\/membership$/);if(memAdmin&&(req.method==='POST'||req.method==='DELETE')){const a=requireRole(req,res,d,['admin','super_admin']);if(!a)return;const target=d.users.find(x=>x.id===memAdmin[1]);if(!target)return json(res,404,{error:'Foydalanuvchi topilmadi'});
        if(req.method==='DELETE'){if(effectiveType(target)==='FREE'){if(syncMembership(target))save(d);return json(res,409,{error:'Foydalanuvchida faol VIP a‘zolik yo‘q'});}revokeMembership(target,a.id);save(d);return json(res,200,{action:'revoked',user:publicUser(target),membership:membershipView(target)});}
        const b=await body(req),type=String(b.type||'').toUpperCase();if(!['SILVER','GOLD','PLATINUM'].includes(type))return json(res,400,{error:'VIP turini tanlang: SILVER, GOLD yoki PLATINUM'});if(!MEMBERSHIP_DURATIONS[b.duration])return json(res,400,{error:'Muddatni tanlang: 3d, 7d, 1m yoki 1y'});
        // Bir xil so‘rov qayta-qayta yuborilsa (ikki marta bosish) muddat ikki marta qo‘shilmasligi uchun
        const last=(target.membershipHistory||[]).at(-1);if(last&&last.action!=='expired'&&last.byAdmin===a.id&&last.type===type&&last.duration===b.duration&&Date.now()-Date.parse(last.at)<5000)return json(res,200,{action:last.action,duplicate:true,user:publicUser(target),membership:membershipView(target)});
        const r=activateMembership(target,type,b.duration,a.id,b.replace===true);
        if(r.conflict){if(syncMembership(target))save(d);const cur=membershipView(target);return json(res,409,{code:'MEMBERSHIP_ACTIVE',error:`Foydalanuvchida hozir ${cur.label} faol (${dmy(cur.expireDate)} gacha). ${MEMBERSHIP_LABELS[type]} ga almashtirilsa, qolgan muddat yo‘qoladi. Davom etasizmi?`,membership:cur});}
        save(d);return json(res,200,{action:r.action,user:publicUser(target),membership:membershipView(target)});}
      // ---- VIP boshqaruvi (faqat admin / super_admin). Foydalanuvchining o‘zi tarifni HECH QACHON o‘zgartira olmaydi. ----
      if(req.method==='GET'&&p==='/api/admin/memberships'){const a=requireRole(req,res,d,['admin','super_admin']);if(!a)return;sweepMemberships(d);
        const users=d.users.map(x=>({id:x.id,name:x.name,email:x.email,role:x.role,status:x.status,membership:membershipView(x),lastActionAt:((x.membershipHistory||[]).slice(-1)[0]||{}).at||null}));
        const active=users.filter(x=>x.membership.active),byType={SILVER:0,GOLD:0,PLATINUM:0};active.forEach(x=>{byType[x.membership.type]++;});
        return json(res,200,{users,summary:{total:users.length,active:active.length,expired:users.filter(x=>x.membership.status==='EXPIRED').length,expiringSoon:active.filter(x=>x.membership.daysLeft<=7).length,byType}});}
      if(req.method==='GET'&&p==='/api/admin/memberships/history'){const a=requireRole(req,res,d,['admin','super_admin']);if(!a)return;sweepMemberships(d);
        const all=membershipRecords(d,url.searchParams.get('userId')||null);return json(res,200,{history:all.slice(0,1000),total:all.length});}
      const memPatch=p.match(/^\/api\/admin\/users\/([^/]+)\/membership$/);if(memPatch&&req.method==='PATCH'){const a=requireRole(req,res,d,['admin','super_admin']);if(!a)return;const target=d.users.find(x=>x.id===memPatch[1]);if(!target)return json(res,404,{error:'Foydalanuvchi topilmadi'});
        const b=await body(req),type=String(b.type||'').toUpperCase();if(!['SILVER','GOLD','PLATINUM'].includes(type))return json(res,400,{error:'VIP turini tanlang: SILVER, GOLD yoki PLATINUM'});
        const r=changeMembershipType(target,type,a.id);if(r.error){if(syncMembership(target))save(d);return json(res,r.status,{error:r.error});}
        save(d);return json(res,200,{action:r.action,user:publicUser(target),membership:membershipView(target)});}
      const manageTicket=p.match(/^\/api\/admin\/support\/([^/]+)$/);if(req.method==='PATCH'&&manageTicket){const u=requireRole(req,res,d,['admin','super_admin','moderator']);if(!u)return;const b=await body(req),ticket=d.supportTickets.find(x=>x.id===manageTicket[1]);if(!ticket)return json(res,404,{error:'Murojaat topilmadi'});if(!['open','in_progress','resolved'].includes(b.status))return json(res,400,{error:'Noto‘g‘ri murojaat holati'});ticket.status=b.status;ticket.updatedAt=now();ticket.assigneeId=u.id;save(d);return json(res,200,{ticket});}
      if(req.method==='POST'&&p==='/api/admin/tests'){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const b=await body(req);const t={id:id('test'),title:String(b.title||'').trim(),category:b.category||'multilevel',description:b.description||'',duration:Number(b.duration)||60,price:Number(b.price)||0,status:b.status||'draft',access:b.access||'free',modules:Array.isArray(b.modules)?b.modules:['reading'],createdAt:now()};if(t.title.length<3)return json(res,400,{error:'Test nomini kiriting'});d.tests.push(t);save(d);return json(res,201,{test:t});}
      if(req.method==='POST'&&p==='/api/admin/media/audio'){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const b=await body(req);if(!['audio/webm','audio/wav','audio/ogg','audio/mp4','audio/mpeg'].includes(b.mime)||typeof b.data!=='string')return json(res,400,{error:'Ruxsat etilgan audio formatini tanlang'});const buffer=Buffer.from(b.data,'base64');if(!buffer.length||buffer.length>10*1024*1024)return json(res,400,{error:'Audio 10 MB dan kichik bo‘lishi kerak'});if(!fs.existsSync(UPLOADS))fs.mkdirSync(UPLOADS,{recursive:true});const ext={"audio/webm":"webm","audio/wav":"wav","audio/ogg":"ogg","audio/mp4":"m4a","audio/mpeg":"mp3"}[b.mime],file=`${id('listening')}.${ext}`;fs.writeFileSync(path.join(UPLOADS,file),buffer);return json(res,201,{url:`/uploads/${file}`});}
      const adminTest=p.match(/^\/api\/admin\/tests\/([^/]+)$/);if(req.method==='PUT'&&adminTest){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const b=await body(req),t=d.tests.find(x=>x.id===adminTest[1]);if(!t)return json(res,404,{error:'Test topilmadi'});Object.assign(t,{title:b.title||t.title,description:b.description??t.description,duration:Number(b.duration)||t.duration,price:Number(b.price??t.price),status:b.status||t.status,access:b.access||t.access,modules:Array.isArray(b.modules)?b.modules:t.modules});save(d);return json(res,200,{test:t});}
      const adminQuestions=p.match(/^\/api\/admin\/tests\/([^/]+)\/questions$/);if(req.method==='GET'&&adminQuestions){const u=requireRole(req,res,d,['admin','super_admin','examiner']);if(!u)return;return json(res,200,{questions:d.questions.filter(q=>q.testId===adminQuestions[1])});}
      if(req.method==='POST'&&adminQuestions){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const b=await body(req);if(!d.tests.some(t=>t.id===adminQuestions[1]))return json(res,404,{error:'Test topilmadi'});if(!b.text||!b.module||!b.type)return json(res,400,{error:'Savol matni, turi va moduli talab qilinadi'});const q={id:id('q'),testId:adminQuestions[1],module:b.module,type:b.type,text:b.text,passage:b.passage||'',audioUrl:b.audioUrl||'',options:Array.isArray(b.options)?b.options:[],correct:b.correct??null,points:Number(b.points)||1,createdAt:now()};d.questions.push(q);save(d);return json(res,201,{question:q});}
      const adminQuestion=p.match(/^\/api\/admin\/questions\/([^/]+)$/);if(req.method==='PUT'&&adminQuestion){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const b=await body(req),q=d.questions.find(x=>x.id===adminQuestion[1]);if(!q)return json(res,404,{error:'Savol topilmadi'});Object.assign(q,{text:b.text??q.text,module:b.module??q.module,type:b.type??q.type,passage:b.passage??q.passage,audioUrl:b.audioUrl??q.audioUrl,options:Array.isArray(b.options)?b.options:q.options,correct:b.correct??q.correct,points:Number(b.points)||q.points});save(d);return json(res,200,{question:q});}
      if(req.method==='DELETE'&&adminQuestion){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const i=d.questions.findIndex(x=>x.id===adminQuestion[1]);if(i<0)return json(res,404,{error:'Savol topilmadi'});d.questions.splice(i,1);save(d);return json(res,204,{});}
      if(req.method==='GET'&&p==='/api/admin/reviews'){const u=requireRole(req,res,d,['admin','super_admin','examiner']);if(!u)return;const rows=d.answers.map(a=>{const q=d.questions.find(x=>x.id===a.questionId),at=d.attempts.find(x=>x.id===a.attemptId),student=d.users.find(x=>x.id===at?.userId);return q&&at&&['writing','speaking'].includes(q.type)&&!d.evaluations.some(e=>e.attemptId===at.id&&e.questionId===q.id)?{answer:a,question:q,attempt:at,student:publicUser(student),test:d.tests.find(t=>t.id===at.testId)}:null}).filter(Boolean);return json(res,200,{submissions:rows});}
      if(req.method==='POST'&&p==='/api/admin/evaluations'){const u=requireRole(req,res,d,['admin','super_admin','examiner']);if(!u)return;const b=await body(req),a=d.attempts.find(x=>x.id===b.attemptId),q=d.questions.find(x=>x.id===b.questionId&&['writing','speaking'].includes(x.type));if(!a||!q)return json(res,404,{error:'Topshiriq topilmadi'});if(a.status!=='completed')return json(res,409,{error:'Urinish hali yakunlanmagan'});const overall=Number(b.overall);if(!Number.isFinite(overall)||overall<0||overall>100)return json(res,400,{error:'Umumiy baho 0–100 oralig‘ida bo‘lishi kerak'});let e=d.evaluations.find(x=>x.attemptId===a.id&&x.questionId===q.id);const value={id:e?.id||id('eval'),attemptId:a.id,questionId:q.id,examinerId:u.id,type:q.type,rubric:b.rubric||{},overall,feedback:String(b.feedback||''),updatedAt:now()};if(e)Object.assign(e,value);else d.evaluations.push(value);recalculateAttempt(d,a);syncSubmission(d,a,{reviewerId:u.id});save(d);const sub=d.submissions.find(x=>x.attemptId===a.id);return json(res,200,{evaluation:value,attempt:attemptView(d,a),submission:sub?submissionView(d,sub,true):null});}
      if(req.method==='POST'&&p==='/api/admin/import-db'){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const b=await body(req),nd=b&&b.data;if(!nd||!Array.isArray(nd.users)||!Array.isArray(nd.tests)||!Array.isArray(nd.questions))return json(res,400,{error:'Bu data.json fayli emas'});try{if(fs.existsSync(DB))fs.copyFileSync(DB,DB+'.pre-import');}catch{}nd.sessions={};save(nd);flushSync();CACHE=null;const nx=load();return json(res,200,{ok:true,users:nx.users.length,tests:nx.tests.length,questions:nx.questions.length});}
      if(req.method==='GET'&&p==='/api/admin/settings'){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;return json(res,200,{settings:d.settings});}
      if(req.method==='PUT'&&p==='/api/admin/settings'){const u=requireRole(req,res,d,['admin','super_admin']);if(!u)return;const b=await body(req);d.settings={...d.settings,...b,thresholds:{...d.settings.thresholds,...(b.thresholds||{})}};save(d);return json(res,200,{settings:d.settings});}
      return json(res,404,{error:'API topilmadi'});
    }
    const upload=p.match(/^\/uploads\/([a-zA-Z0-9_.-]+)$/);if(upload){const file=path.join(UPLOADS,upload[1]);if(!file.startsWith(UPLOADS)||!fs.existsSync(file))return json(res,404,{error:'Fayl topilmadi'});const ext=path.extname(file);const types={'.webm':'audio/webm','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.mp3':'audio/mpeg'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff'});return fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);}
    return serveStatic(req,res,p);
  } catch(e){json(res,500,{error:e.message||'Server xatosi'});}
});
let activePort=Number(PORT),fallbackAttempts=0;
server.on('listening',()=>console.log(`CEFR MASTER http://localhost:${activePort}`));
server.on('error',error=>{
  if(error.code==='EADDRINUSE'&&fallbackAttempts<10){
    activePort++;fallbackAttempts++;
    console.warn(`Port ${activePort-1} band. CEFR MASTER http://localhost:${activePort} da ishga tushmoqda...`);
    server.listen(activePort);
    return;
  }
  console.error(error);
  process.exit(1);
});
load(); // bazani oldindan xotiraga yuklaymiz (birinchi so‘rov sekin bo‘lmasin)
{const d=load();if(d.sessions){let n=0;for(const k of Object.keys(d.sessions))if(Date.now()-d.sessions[k].createdAt>SESSION_TTL){delete d.sessions[k];n++;}if(n)save(d);}}
sweepMemberships(load());setInterval(()=>{try{sweepMemberships(load());}catch(e){console.error('A‘zolik tekshiruvi xatosi:',e.message);}},60*60*1000).unref();
server.listen(activePort);
