let grouped = {};
const closeTimers = {}; // orderId -> timeoutId

/* 
 - pobiera zamowienia z serwera i aktualizuje karty na ekranie
 - nowe karty sa dodawane a stare usuwane bez "migania' calej strony
 */
async function loadOrders() 
{
    const container = document.getElementById('orders');
    
    if (container.innerHTML === 'Ładowanie..') 
        container.innerHTML = '';

    const response = await fetch('/api/orders');
    const data = await response.json();

    // zapisz lokalne statusy przed resetem
    const lokalneStatusy = {};
    Object.entries(grouped).forEach(([id, order]) => {
        order.items.forEach(item => {
            lokalneStatusy[item.id] = { status: item.status, done: item.done };
        });
    });

    // reset grouped
    grouped = {};

    data.forEach(row =>
    {   
        if (!grouped[row.id_pos_order]) 
        {
            grouped[row.id_pos_order] = 
            {
                name: row.name,
                created_at: row.created_at,
                items: []
            }
        }

        if (row.item_name)
        {
            const lokalny = lokalneStatusy[row.id_pos_order_line];
            
            grouped[row.id_pos_order].items.push({
                name: row.item_name,
                parent: row.id_pos_order_line_parent, 
                id: row.id_pos_order_line,
                done: lokalny ? lokalny.done : (row.kds_served != null && row.kds_served !== '0000-00-00 00:00:00'),
                status: lokalny ? lokalny.status : (row.kds_status == null ? 0 : Number(row.kds_status)),
                qty: row.qty,
                category: row.item_category,
                note: row.note
            });
        } 
    });

    /* usun karty zamowien ktorych juz nie ma w bazie */
    Array.from(container.children).forEach(karta => {
        if (!grouped[karta.dataset.id]) karta.remove();
    });

    /* dla kazdego zamowienia - stworz nowa karte lub zaktualizuj istniejaca */
    Object.entries(grouped).forEach(([id, order]) => {
        let div = container.querySelector(`[data-id="${id}"]`);

        console.log('po loadOrders', id, order.items.map(i => i.status));
        
    if (!div) 
    {
        div = document.createElement('div');
        div.className = 'karta';
        div.dataset.id = id;
        container.appendChild(div);
        div.style.animation = 'slide-in 0.1s ease'; // animacja tylko dla nowych kart
    }

        const orderId = Number(id);

        const all2 = order.items.every(i => Number(i.status) === 2);
        const all0 = order.items.every(i => Number(i.status) === 0);

        const statusZamowienia = all2 ? 2 : all0 ? 0 : 1;
        const kolorNaglowka = statusZamowienia === 2 ? '#2d8a4e' : statusZamowienia === 0 ? '#c0392b' : '#ff8c00';

        /* aktualizuj zawartosc karty przy kazdym odswiezeniu
         , pozycje moga znikac gdy kucharz je oznacza */
        renderKarta(div, orderId, order);
    });

    if(workMode)
    {
        sumTrybPraca();
    }
}

/*
 - oznacza cale zamowienie jako gotowe przez zmiane statusu na 2
 - jesli zamowienie juz jest gotowe (status 2) - nic nie robi
 */
async function gotowe(id,statusZamowienia) 
{
    console.log('gotowe klik', id, statusZamowienia, typeof statusZamowienia)
    const karta = document.querySelector(`[data-id="${id}"]`);

    if (karta)
    {
        if (statusZamowienia != 2) 
        {
            const naglowek = karta.querySelector('.naglowek');
            naglowek.style.background = '#2d8a4e';
            
            
            await zmienStatus(id,2);
        }
    }
}

/*
 - oznacza pojedyncza pozycje jako gotowa
 - aktualizuje kolor naglowka i przerysowuje karte
 - jesli wszystkie pozycje sa gotowe - uruchamia timer 30s po ktorym zamowienie znika
 */
async function gotoweLinia(lineId, orderId) 
{
    const r = await fetch(`/api/done/line/${lineId}`, { method: 'POST' });
    const result = await r.json();

    if (grouped[orderId]) 
    {
        const item = grouped[orderId].items.find(i => i.id == lineId);
        if (item) 
        {
            item.done = true;
            item.status = 2;
        }
    }

    ustawKolorNaglowka(orderId);

    const div = document.querySelector(`[data-id="${orderId}"]`);
    if (div && grouped[orderId] && !div.classList.contains('znika')) 
    {
        renderKarta(div, orderId, grouped[orderId]);
    }

    const p = document.querySelector(`[data-id="${orderId}"] p[onclick*="${lineId}"]`);

    if (p) 
    {
        p.style.background = '#444';
        p.style.color = '#888';
    }

    if (result.allServed) 
    {
        closeTimers[result.orderId] = setTimeout(async () => {
            const karta = document.querySelector(`[data-id="${result.orderId}"]`);
            console.log('karta:', karta, 'klasy PRZED:', karta?.className);
            if (karta) {
            karta.classList.add('znika');
            console.log('klasy PO:', karta.className);
            }
            setTimeout(async () => {
                await fetch(`/api/done/${result.orderId}`, { method: 'POST' });
                delete closeTimers[result.orderId];
                loadOrders();
            }, 600);
        }, 5000); 
    }
}

/*
 - cofa oznaczenie pozycji jako gotowej
 - aktualizuje kolor naglowka na zolty lub czerwony
 - anuluje timer znikania jesli byl ustawiony
 */        
async function undoLinia(lineId, orderId) 
{
    // natychmiast lokalnie zmien stan (zeby od razu bylo zolte)
    if (grouped[orderId]) 
    {
        const item = grouped[orderId].items.find(i => i.id == lineId);
        if (item) 
        {
            item.done = false;
            item.status = 0;
            console.log('po undo lokalnie', grouped[orderId].items.map(i => i.status));
        }
    }

    if (closeTimers[orderId]) 
    {
        clearTimeout(closeTimers[orderId]);
        delete closeTimers[orderId];
    }

    ustawKolorNaglowka(orderId); // od razu zmienia naglowek na zolty/czerwony

    const r = await fetch(`/api/undo/line/${lineId}`, { method: 'POST' });
    const result = await r.json();
    console.log('undo response', result);

    const oid = result.orderId ?? orderId;

    loadOrders();
}

/*
 - buduje html karty zamowienia i wstawia do diva
 - sortuje pozycje - niegotowe na gorze, gotowe na dole
 - kolor naglowka zalezy od statusu zamowienia
 */
function renderKarta(div, orderId, order)
{
    const all2 = order.items.every(i => Number(i.status) === 2);
    const all0 = order.items.every(i => Number(i.status) === 0);
    const statusZamowienia = all2 ? 2 : all0 ? 0 : 1;
    const kolorNaglowka = statusZamowienia === 2 ? '#2d8a4e' : statusZamowienia === 0 ? '#c0392b' : '#ff8c00';

    div.innerHTML = `
        <div class="naglowek" onclick="gotowe(${orderId},${statusZamowienia})" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; position:relative; background:${kolorNaglowka};">
            <div>
                <h2 style="margin:0;">Zamówienie #${orderId}</h2>
                <span class="timer" data-start="${new Date(order.created_at).getTime()}" style="margin-left:8px;">00:00</span>
            </div>
            <button onclick="event.stopPropagation(); pokazMenu(${orderId}, this)" style="background:#C0C0C0; color:#000000; border:none; border-radius:6px; padding:10px 30px; cursor:pointer; font-size:1.4rem;">⋯</button>
        </div>
        <p class="godzina">${new Date(order.created_at).toLocaleTimeString('pl-PL')}</p>
        <div class="tresc">
            <p class="stol">Stół: ${order.name}</p>
            ${[...order.items.filter(i => !i.done && i.status != 2), ...order.items.filter(i => i.done || i.status == 2)].map(item => {
                item.qty = Number(item.qty);
                const fn = item.done || item.status == 2 ? 'undoLinia' : 'gotoweLinia';
                if (item.qty == 1) {
                    return `
                        <p onclick="${fn}(${item.id}, ${orderId})" style="cursor:pointer; ${item.done || item.status == 2 ? 'background:#444; color:#888;' : ''}">
                            ${item.name}
                            ${item.note ? `<small style="color:#ced5d6; font-size:0.9rem; display:block; padding:2px 0;">${item.note}</small>` : ''}
                        </p>`;
                } else {
                    return `
                        <p onclick="${fn}(${item.id}, ${orderId})" style="cursor:pointer; ${item.done || item.status == 2 ? 'background:#444; color:#888;' : ''}display:flex; justify-content:space-between; align-items:center;">
                            <span>${item.name}</span>
                            ${item.note ? `<small style="color:#ced5d6; font-size:0.9rem; display:block; padding:2px 0;">${item.note}</small>` : ''}
                            <span style="margin-left:12px; font-weight:700;">${item.qty}x</span>
                        </p>`;
                }
            }).join('')}
        </div>
    `;
}

/*
 - liczy ile sztuk kazdego produktu jest do zrobienia
 - pomija pozycje ktore sa juz gotowe
 - wyswietla wynik w okienku modal
 */

function pokazPodsumowanie() 
{
    let summed = {}; 

// przechodzenie przez grouped i zsumowanie ilosci
    Object.entries(grouped).forEach(([orderId, order]) => {
        order.items.forEach(item => {
            if (item.done) return;

            const itemName = item.name;
            const qty = Number(item.qty) || 0;

            if (!summed[itemName]) 
            {
                summed[itemName] = 0;
            }
            summed[itemName] += qty;
        });
    });

    // pokazanie wyniku w okienku
    let tekst = '';
    Object.entries(summed).forEach(([nazwa, ilosc]) => {
        tekst += nazwa + ': ' + ilosc + '\n'; 
    });

    const modal = document.getElementById('modal');
    const tresc = document.getElementById('modal-tresc');
    
    tresc.innerHTML = Object.entries(summed)
        .map(([nazwa, ilosc]) => `<p style="display:flex; justify-content:space-between; align-items:center; font-size:0.9rem;">
                        <span>${nazwa}</span>
                        <span style="margin-left:12px; font-weight:700;">${ilosc}x</span>
                    </p>`)
        .join('');
    modal.style.display = 'flex';
}

let workMode = false;

/*
 - przelacza tryb pracy
 - w trybie pracy pokazuje panel z podsumowaniem po lewej stronie
 - chowa przycisk podsumowanie
 */

function trybPracy() 
{
    workMode = !workMode;

    const btnPodsumowanie = document.getElementById('btn-podsumowanie');
    const btnTrybPracy    = document.getElementById('btn-tryb-pracy');

    if (workMode) 
    {
        btnTrybPracy.textContent = 'TRYB PRACY: WŁ.';
        document.body.classList.add('work-mode');

        btnPodsumowanie.style.visibility = 'hidden';
        sumTrybPraca();
    } 
    else 
    {
        btnTrybPracy.textContent = 'TRYB PRACY: WYŁ.';
        document.body.classList.remove('work-mode');

        btnPodsumowanie.style.visibility = 'visible';
    }
}

/*
 - liczy produkty do zrobienia z podzialem na kategorie
 - aktualizuje panel po lewej stronie w trybie pracy
 */

function sumTrybPraca()
{
    const panel = document.getElementById('summary-panel-content');
    if (!panel) return;

    const summary = {};

    Object.entries(grouped).forEach(([orderId, order]) => {
        order.items.forEach(item => {
            if (item.done || item.status == 2) return;

            const category = item.category || 'INNE';
            const itemName = item.name;
            const qty = Number(item.qty) || 0;

            if (!summary[category]) summary[category] = {};
            if (!summary[category][itemName]) summary[category][itemName] = 0;

            summary[category][itemName] += qty;
        });
    });

    let html = '';
    for (const category in summary) 
    {
        html += '<div style="margin-bottom:16px;">';
        html += `<h3 style="margin:0 0 4px; color:#ffb347; font-size:1.1rem;">${category}</h3>`;

        for (const [name, qty] of Object.entries(summary[category])) 
        {
            html += `<p style="display:flex; justify-content:space-between; align-items:center;font-size:0.9rem">
                        <span>${name}</span>
                        <span style="margin-left:12px; font-weight:700;">${qty}x</span>
                     </p>`;
        }

        html += '</div>';
    }
            
    if (html === '') html = '<p>Brak pozycji do przygotowania.</p>';

    panel.innerHTML = html;
}

/*
 - pokazuje menu z opcjami zmiany statusu zamowienia
 - jesli menu juz jest otwarte - zamyka je
 */

function pokazMenu(orderId, btn) 
{
    // usun stare menu jesli istnieje
    const stare = document.getElementById('menu-popup');
    if (stare)
    {
        stare.remove();
        return;
    } 

    const menu = document.createElement('div');
    menu.id = 'menu-popup'; 
    menu.style = 'position:absolute; top:100%; right:0; background:#333; border:1px solid #555; border-radius:8px; padding:8px; z-index:999;'; // pojawienie sie w miejscu przycisku 

    menu.innerHTML = `
   
        <p onclick="event.stopPropagation(); zmienStatus(${orderId}, 1)" style="cursor:pointer; background:#ff8c00; margin:4px 0;">W przygotowaniu</p>
        <p onclick="event.stopPropagation(); zmienStatus(${orderId}, 2)" style="cursor:pointer; background:#2d8a4e; margin:4px 0;">Gotowe do wydania</p>
    `;
    
    btn.parentElement.appendChild(menu);  // dodaje menu obok przycisku ktory kliknalem 
}

/*
 - zmienia status wszystkich pozycji zamowienia
 - jesli status 2 - uruchamia timer 30s po ktorym zamowienie znika
 - jesli inny status - anuluje timer jesli byl ustawiony
 */

async function zmienStatus(orderId, status) 
{
    // zmien status wszystkich pozycji zamowienia 
    const karta = document.querySelector(`[data-id="${orderId}"]`);

    // wyslij request dla kazdej pozycji
    const items = grouped[orderId].items;
    for (const item of items) 
    {
        await fetch(`/api/status/line/${item.id}/${status}`, { method: 'POST' });
    }

    grouped[orderId].items.forEach(item => {
        item.status = status;

        if (status !== 2) item.done = false;
    });
    
    ustawKolorNaglowka(orderId);


    if (status === 2) 
    {
        if (closeTimers[orderId]) clearTimeout(closeTimers[orderId]);
        closeTimers[orderId] = setTimeout(async () => {
            karta.classList.add('znika');
            setTimeout(async () => {
                await fetch(`/api/done/${orderId}`, { method: 'POST' });
                delete closeTimers[orderId];
                loadOrders();
            }, 600);
        }, 30000);
    } 

    else 
    {
        if (closeTimers[orderId]) 
        {
            clearTimeout(closeTimers[orderId]);
            delete closeTimers[orderId];
        }
    }

    const menu = document.getElementById('menu-popup');
    if (menu) menu.remove();

    loadOrders();
}

/*
 - oblicza kolor naglowka na podstawie statusow pozycji
 - czerwony: wszystkie status 0
 - zolty: mieszane statusy
 - zielony: wszystkie status 2
 */

function ustawKolorNaglowka(orderId) 
{
    const karta = document.querySelector(`[data-id="${orderId}"]`);
    if (!karta || !grouped[orderId]) return;

    const items = grouped[orderId].items || [];
    console.log('statusy po kliknieciu:', items.map(i => i.status));
    if (!items.length) return;

    const all2 = items.every(i => Number(i.status) === 2);
    const all0 = items.every(i => Number(i.status) === 0);

    const kolor = all2 ? '#2d8a4e' : all0 ? '#c0392b' : '#ff8c00';

    const naglowek = karta.querySelector('.naglowek');
    if (naglowek) naglowek.style.background = kolor;
}

/* aktualizuje timery na wszystkich kartach co sekunde */
setInterval(() => {
    document.querySelectorAll('.timer').forEach(timer => {
        const start = Number(timer.dataset.start); /* czas zlozenia zamowienia w milisek */
        const diff = Math.floor((Date.now() - start) / 1000); /* ile sekund minelo */
        const min = String(Math.floor(diff / 60)).padStart(2, '0'); /* minuty z wiodacym zerem */
        const sec = String(diff % 60).padStart(2, '0'); /* sekundy z wiodacym zerem */
        timer.textContent = `${min}:${sec}`;
    });
}); 

setInterval(loadOrders, 5000); /* odswieza zamowienia co 5 sekund */
loadOrders(); 
