/* Sends the 9am phone alerts: today's to-dos, birthdays today, birthdays tomorrow. */

function londonParts(now){
    const f = new Intl.DateTimeFormat("en-GB",{
        timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"
    });
    const p = {};
    f.formatToParts(now).forEach(function(x){ p[x.type] = x.value; });
    return {year:+p.year,month:+p.month,day:+p.day,hour:+p.hour};
}

function key(y,m,d){
    return y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
}

function addDays(y,m,d,n){
    const t = new Date(Date.UTC(y,m-1,d+n));
    return {year:t.getUTCFullYear(),month:t.getUTCMonth()+1,day:t.getUTCDate()};
}

function isLeap(y){ return (y%4===0 && y%100!==0) || y%400===0; }

/* Does this date of birth have its birthday on the given day? (29 Feb counts as 28 Feb in non-leap years) */
function hasBirthday(dob,y,m,d){
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || "");
    if(!match) return null;
    let bm = +match[2], bd = +match[3];
    if(bm===2 && bd===29 && !isLeap(y)) bd = 28;
    if(bm===m && bd===d) return {turns:y - (+match[1])};
    return null;
}

function todosFor(dateKey,rota,overrides){
    const out = [];
    const o = (overrides && overrides[dateKey]) || {};
    const l = (rota && rota[dateKey]) || {};
    [["mine","Paul"],["yours","Rachel"]].forEach(function(pair){
        const who = pair[0], name = pair[1];
        const text = (o[who] && o[who].todo) || (l[who] && l[who].todo);
        if(text) out.push(name+": "+text);
    });
    return out;
}

function buildMessages(db,y,m,d){
    const msgs = [];
    const today = key(y,m,d);

    const todos = todosFor(today,db.rota,db.rotaOverrides);
    if(todos.length){
        msgs.push({tag:"todo-"+today,title:"To do today",body:todos.join("\n")});
    }

    const t = addDays(y,m,d,1);
    Object.entries(db.birthdays || {}).forEach(function(entry){
        const id = entry[0], person = entry[1];
        if(!person || !person.name) return;

        const now = hasBirthday(person.dob,y,m,d);
        if(now){
            msgs.push({tag:"bday-"+id+"-"+today,title:"Birthday today 🎂",body:"It's "+person.name+"'s birthday today! 🎉"});
        }

        const next = hasBirthday(person.dob,t.year,t.month,t.day);
        if(next){
            msgs.push({tag:"bday-eve-"+id+"-"+today,title:"Birthday tomorrow",body:"Don't forget "+person.name+"'s birthday tomorrow!"});
        }
    });

    return msgs;
}

module.exports = {londonParts,buildMessages,todosFor,hasBirthday};

async function main(){
    const admin = require("firebase-admin");
    const testMode = process.env.TEST_MODE === "true";

    admin.initializeApp({
        credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        databaseURL:process.env.DATABASE_URL
    });
    const db = admin.database();

    const now = londonParts(new Date());
    const today = key(now.year,now.month,now.day);

    if(!testMode){
        if(now.hour < 9 || now.hour >= 13){
            console.log("Not the alert window (UK hour "+now.hour+"). Nothing to do.");
            return;
        }
        const sentRef = db.ref("pushSent/"+today);
        const claim = await sentRef.transaction(function(v){ return v ? undefined : Date.now(); });
        if(!claim.committed){
            console.log("Already sent today.");
            return;
        }
    }

    const snap = await db.ref("pushTokens").once("value");
    const tokens = Object.keys(snap.val() || {});
    if(!tokens.length){
        console.log("No phones registered yet.");
        return;
    }

    let msgs;
    if(testMode){
        msgs = [{tag:"test",title:"Alerts are working ✅",body:"You'll get your to-dos and birthdays here at 9am."}];
    }else{
        const [rota,overrides,birthdays] = await Promise.all([
            db.ref("rota").once("value"),
            db.ref("rotaOverrides").once("value"),
            db.ref("birthdays").once("value")
        ]);
        msgs = buildMessages({rota:rota.val(),rotaOverrides:overrides.val(),birthdays:birthdays.val()},now.year,now.month,now.day);
    }

    if(!msgs.length){
        console.log("Nothing to alert about today.");
        return;
    }

    for(const m of msgs){
        const res = await admin.messaging().sendEachForMulticast({
            tokens:tokens,
            data:{title:m.title,body:m.body,tag:m.tag},
            webpush:{headers:{Urgency:"high",TTL:"43200"}}
        });

        const dead = [];
        res.responses.forEach(function(r,i){
            if(!r.success){
                const code = r.error && r.error.code;
                console.log("Send failed:",code);
                if(code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token"){
                    dead.push(tokens[i]);
                }
            }
        });
        for(const t of dead) await db.ref("pushTokens/"+t).remove();
        console.log("Sent '"+m.title+"' to "+res.successCount+" phone(s).");
    }
}

if(require.main === module){
    main().then(function(){ process.exit(0); }).catch(function(e){ console.error(e); process.exit(1); });
}
