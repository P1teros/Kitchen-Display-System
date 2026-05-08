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

    console.log(data[0]);

    /* grupowanie wierszy z bazy po id zamowienia*/
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

        if (row.item_name) /*sprawdzanie czy wiersz ma nazwe pozycji (moze byc null jesli zamwienie jest puste)*/
        {
            grouped[row.id_pos_order].items.push({
                name: row.item_name,
                parent: row.id_pos_order_line_parent, 
                id: row.id_pos_order_line,
                done: row.kds_served != null && row.kds_served !== '0000-00-00 00:00:00',
                status: row.kds_status,
                qty: row.qty,
                category: row.item_category
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
        
        if (!div) {
            div = document.createElement('div');
            div.className = 'karta';
            div.dataset.id = id; /* id zamowienia w html uzywane do wyszukiwania karty */
            container.appendChild(div);
        }

        const orderId = Number(id);

        const statusZamowienia = order.items.every(i => i.status == 2) ? 2 : order.items.some(i => i.status == 1) ? 1 : 0;
        const kolorNaglowka = statusZamowienia == 2 ? '#2d8a4e' : statusZamowienia == 1 ? '#ff8c00' : '#c0392b';

        /* aktualizuj zawartosc karty przy kazdym odswiezeniu
         , pozycje moga znikac gdy kucharz je oznacza */
        div.innerHTML = `
                <div class="naglowek" onclick="gotowe(${orderId},${statusZamowienia} )" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; position:relative; background:${kolorNaglowka};"> <div>
                    <h2 style="margin:0;">Zamówienie #${id}</h2>
                    <span class="timer" data-start="${new Date(order.created_at).getTime()}" style="margin-left:8px;">00:00</span>
                </div>
                <button onclick="event.stopPropagation(); pokazMenu(${orderId}, this)" style="background:#C0C0C0; color:#zzz; border:none; border-radius:6px; padding:10px 30px; cursor:pointer; font-size:1.4rem;">⋯</button>
            </div>
            <p class="godzina">${new Date(order.created_at).toLocaleTimeString('pl-PL')}</p>
            <div class="tresc">
                <p class="stol">Stół: ${order.name}</p>

                ${[...order.items.filter(i => !i.done), ...order.items.filter(i => i.done)].map(item => {
                    const fn = item.done ? 'undoLinia' : 'gotoweLinia';
                    return `<p onclick="${fn}(${item.id}, ${orderId})" style="cursor:pointer; ${item.done ? 'background:#444; color:#888;' : ''}">${item.name}</p>`;
                }).join('')}
            </div>
        `;
    });

    if(workMode)
    {
        sumTrybPraca();
    }
}

/* oznacza cale zamowienie jako gotowe ,najpierw odpala animacje znikania potem wysyla request do serwera  */
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
    1. oznacza pojedyncza pozycje jako gotowa
    2. jesli to byla ostatnia pozycja - animuje znikniecie calej karty
 */
async function gotoweLinia(lineId, orderId) 
{
    const r = await fetch(`/api/done/line/${lineId}`, { method: 'POST' });
    const result = await r.json(); // { ok, orderId, allServed }

    if (result.allServed) 
    {
        const karta = document.querySelector(`[data-id="${result.orderId}"]`);

        if (karta) 
        {
            const naglowek = karta.querySelector('.naglowek');

            if (naglowek) naglowek.style.background = '#2d8a4e';
        }

        // anuluj ewentualnie stary timer (gdyby się dublował)
        if (closeTimers[result.orderId]) clearTimeout(closeTimers[result.orderId]);

        closeTimers[result.orderId] = setTimeout(async () => {
            await fetch(`/api/done/${result.orderId}`, { method: 'POST' });
            delete closeTimers[result.orderId];
            loadOrders();
        }, 30000);

        loadOrders();
        return;
    }

    loadOrders();
}

async function undoLinia(lineId, orderId) 
{
    const r = await fetch(`/api/undo/line/${lineId}`, { method: 'POST' });
    const result = await r.json();

    const oid = result.orderId ?? orderId;

    if (closeTimers[oid]) 
    {
        clearTimeout(closeTimers[oid]);
        delete closeTimers[oid];
    }

    loadOrders();
}

function pokazPodsumowanie() 
{
    const summed = {}; 

// przechodzenie przez grouped i zsumowanie ilosci
    Object.entries(grouped).forEach(([id, order]) => {
        order.items.forEach(item => {

            if (item.done)
            {
                return;    
            }
            
            if (summed[item.name]) 
            {
                summed[item.name]++;
            }
            else
            {
                summed[item.name] = 1;
            }
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
        .map(([nazwa, ilosc]) => `<p style="font-size:0.9rem; padding:10px 10px; margin:2px 0;">${nazwa}: ${ilosc}</p>`)
        .join('');
    modal.style.display = 'flex';
}

let workMode = false;

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
function sumTrybPraca()
{
    const panel = document.getElementById('summary-panel-content');
    if (!panel) return;

    const summary = {};

    Object.entries(grouped).forEach(([orderId, order]) => {
        order.items.forEach(item => {
            if (item.done) return;
            const category = item.category || 'INNE';
            const itemName = item.name;
            const qty = Number(item.qty) || 0;

            if (!summary[category]) 
            {
                summary[category] = {};
            }

            if (!summary[category][itemName]) 
            {
                summary[category][itemName] = 0;
            }
            summary[category][itemName] += qty;
        });
    });

    let html = '';
    for (const category in summary) 
    {
        html += '<div style="margin-bottom:16px;">';
        html += `<h3 style="margin:0 0 8px; color:#ffb347;">${category}</h3>`;

        const products = summary[category];

        for (const name in products) 
        {
            const qty = products[name];
            html += `<p style="margin:4px 0;">${name}: ${qty}</p>`;
        }

        html += '</div>';
    }
            
    if (html === '') 
    {
        html = '<p>Brak pozycji do przygotowania.</p>';
    }
    panel.innerHTML = html;
}

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

async function zmienStatus(orderId, status) 
{
    // zmien status wszystkich pozycji zamowienia 
    const karta = document.querySelector(`[data-id="${orderId}"]`);
    const pozycje = karta.querySelectorAll('.tresc p:not(.stol)');
    
    // wyslij request dla kazdej pozycji
    const items = grouped[orderId].items;
    for (const item of items) 
    {
        await fetch(`/api/status/line/${item.id}/${status}`, { method: 'POST' });
    }

    if (status === 2) 
    {
        const naglowek = karta.querySelector('.naglowek');
        naglowek.style.background = '#2d8a4e';
        
        setTimeout(async() => {
            karta.classList.add('znika');
            setTimeout(async() => {
                await fetch(`/api/done/${orderId}`, { method: 'POST' });  
                loadOrders();   
            }, 600);
        }, 30000);
    }
    
    else
    {
        loadOrders();
    }
    document.getElementById('menu-popup').remove(); //zamyka menu
    grouped[orderId].items.forEach(item => {
        item.status = status;
    });

    loadOrders();
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
