importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js");

firebase.initializeApp({
    apiKey: "AIzaSyB2bPJ5v4p10BqgSg_3y2_D1bwetmcPXi0",
    authDomain: "shared-rota.firebaseapp.com",
    databaseURL: "https://shared-rota-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "shared-rota",
    storageBucket: "shared-rota.firebasestorage.app",
    messagingSenderId: "632941830643",
    appId: "1:632941830643:web:e4eafb14ac067862bbb286"
});

const messaging = firebase.messaging();

/* Alerts are sent as data-only messages, so we show the pop-up ourselves. */
messaging.onBackgroundMessage(function(payload){
    const d = payload.data || {};
    return self.registration.showNotification(d.title || "Rota", {
        body: d.body || "",
        icon: "apple-touch-icon.png",
        tag: d.tag || undefined
    });
});

self.addEventListener("notificationclick", function(event){
    event.notification.close();
    event.waitUntil(
        clients.matchAll({type:"window",includeUncontrolled:true}).then(function(list){
            for(const c of list){
                if("focus" in c) return c.focus();
            }
            return clients.openWindow("./");
        })
    );
});
