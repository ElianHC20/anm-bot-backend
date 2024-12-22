const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

let client = null;
let qr = null;

// Objeto para almacenar los estados de las conversaciones
const chatStates = new Map();

// Configuración de servicios y precios
const services = {
    '1': {
        name: 'Animación 3D y 2D',
        options: {
            'a': 'Animación 3D Básica - $500',
            'b': 'Animación 3D Avanzada - $1000',
            'c': 'Animación 2D Básica - $300',
            'd': 'Animación 2D Avanzada - $600'
        }
    },
    '2': {
        name: 'Marketing',
        options: {
            'a': 'Plan Básico - $200/mes',
            'b': 'Plan Profesional - $500/mes',
            'c': 'Plan Empresarial - $1000/mes'
        }
    },
    '3': {
        name: 'Diseño Web',
        options: {
            'a': 'Landing Page - $300',
            'b': 'Sitio Web Básico - $800',
            'c': 'E-commerce - $2000'
        }
    },
    '4': {
        name: 'Apps y Chatbots',
        options: {
            'a': 'App Básica - $1500',
            'b': 'App Avanzada - $3000',
            'c': 'Chatbot Personalizado - $500'
        }
    }
};

// Combos promocionales
const combos = {
    '1': 'COMBO EMPRENDEDOR:\n- Landing Page\n- Chatbot Básico\n- Plan Marketing Básico\nPrecio: $800 (Ahorro de $200)',
    '2': 'COMBO PROFESIONAL:\n- Sitio Web Completo\n- Animación 2D\n- Plan Marketing Profesional\nPrecio: $1500 (Ahorro de $400)',
    '3': 'COMBO EMPRESARIAL:\n- E-commerce\n- Animación 3D\n- App Básica\n- Plan Marketing Empresarial\nPrecio: $4000 (Ahorro de $1000)'
};

// Configurar CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Función para manejar la inactividad
const handleInactivity = async (from) => {
    const state = chatStates.get(from);
    if (!state) return;

    if (Date.now() - state.lastMessage > 120000) { // 2 minutos
        if (!state.warningShown) {
            await client.sendMessage(from, '⚠️ Si no hay respuesta en los próximos 2 minutos, el chat se reiniciará automáticamente.');
            state.warningShown = true;
            
            // Programar reinicio después de 2 minutos adicionales
            setTimeout(async () => {
                if (Date.now() - state.lastMessage > 240000) { // 4 minutos en total
                    await client.sendMessage(from, '🔄 Chat reiniciado por inactividad. Cualquier mensaje que envíes iniciará una nueva conversación.');
                    chatStates.delete(from);
                }
            }, 120000);
        }
    }
};

const transferToAgent = async (from, customerName) => {
    const state = chatStates.get(from);
    if (!state) return;

    state.withAgent = true;
    state.lastMessage = Date.now();
    state.warningShown = false;

    await client.sendMessage(from, 
        '👨‍💼 Te estamos transfiriendo con un asesor. El bot quedará desactivado.\n\n' +
        'Si no hay respuesta en 2 minutos, el chat se reiniciará automáticamente.\n\n' +
        'Escribe "menu" en cualquier momento para volver al menú principal.'
    );

    // Iniciar temporizador de inactividad para el asesor
    const checkAgentInactivity = async () => {
        const currentState = chatStates.get(from);
        if (!currentState || !currentState.withAgent) return;

        if (Date.now() - currentState.lastMessage > 120000) { // 2 minutos
            if (!currentState.warningShown) {
                await client.sendMessage(from, '⚠️ Si no hay respuesta en los próximos 2 minutos, el chat se reiniciará automáticamente.');
                currentState.warningShown = true;

                // Programar reinicio después de 2 minutos adicionales
                setTimeout(async () => {
                    const finalState = chatStates.get(from);
                    if (finalState && finalState.withAgent && Date.now() - finalState.lastMessage > 240000) {
                        await client.sendMessage(from, '🔄 Chat reiniciado por inactividad. Cualquier mensaje que envíes iniciará una nueva conversación.');
                        chatStates.delete(from);
                    }
                }, 120000);
            }
        }
    };

    // Iniciar chequeo de inactividad
    setTimeout(checkAgentInactivity, 120000);
};

const sendMainMenu = async (from, customerName) => {
    const menu = `¡Hola ${customerName}! 👋\nBienvenido a ANM. ¿En qué podemos ayudarte?\n\n` +
                '1️⃣ Animación 3D y 2D\n' +
                '2️⃣ Marketing\n' +
                '3️⃣ Diseño Web\n' +
                '4️⃣ Apps y Chatbots\n' +
                '5️⃣ Ver Combos Promocionales\n' +
                '6️⃣ Hablar con un asesor\n\n' +
                'Responde con el número de la opción que te interese.';
    await client.sendMessage(from, menu);
};

const createWhatsAppClient = () => {
    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--no-first-run',
                '--single-process',
                '--no-zygote'
            ]
        }
    });

    // Manejar mensajes entrantes
    client.on('message', async (msg) => {
        const from = msg.from;
        const messageBody = msg.body.toLowerCase();
        
        // Obtener el nombre del contacto
        const contact = await msg.getContact();
        const customerName = contact.pushname || 'Cliente';

        // Si es un nuevo chat o no existe el estado, mostrar el menú principal
        if (!chatStates.has(from)) {
            chatStates.set(from, {
                stage: 'menu',
                lastMessage: Date.now(),
                warningShown: false,
                withAgent: false
            });
            await sendMainMenu(from, customerName);
            return;
        }

        const state = chatStates.get(from);
        state.lastMessage = Date.now();
        state.warningShown = false;

        // Si está con un asesor, solo procesar "menu" para volver
        if (state.withAgent) {
            if (messageBody === 'menu') {
                state.withAgent = false;
                state.stage = 'menu';
                await sendMainMenu(from, customerName);
            }
            return;
        }

        // Si es un mensaje de menú, reiniciar estado
        if (messageBody === 'menu') {
            state.stage = 'menu';
            state.withAgent = false;
            await sendMainMenu(from, customerName);
            return;
        }

        // Manejar estados de la conversación
        switch (state.stage) {
            case 'menu':
                switch (messageBody) {
                    case '1':
                    case '2':
                    case '3':
                    case '4':
                        const service = services[messageBody];
                        let optionsMessage = `${service.name}:\n\n`;
                        Object.entries(service.options).forEach(([key, value]) => {
                            optionsMessage += `${key}) ${value}\n`;
                        });
                        optionsMessage += '\nResponde con la letra de la opción para más información.';
                        state.stage = 'service_' + messageBody;
                        await client.sendMessage(from, optionsMessage);
                        break;
                    
                    case '5':
                        let combosMessage = '🎁 Combos Promocionales:\n\n';
                        Object.entries(combos).forEach(([key, value]) => {
                            combosMessage += `${key}) ${value}\n\n`;
                        });
                        combosMessage += '\nResponde con el número del combo para más información.';
                        state.stage = 'combos';
                        await client.sendMessage(from, combosMessage);
                        break;
                    
                    case '6':
                        await transferToAgent(from, customerName);
                        break;
                    
                    default:
                        await client.sendMessage(from, '❌ Opción no válida. Por favor, selecciona una opción del menú (1-6).');
                }
                break;

            case 'service_1':
            case 'service_2':
            case 'service_3':
            case 'service_4':
                const serviceNum = state.stage.split('_')[1];
                const service = services[serviceNum];
                if (service.options[messageBody]) {
                    await transferToAgent(from, customerName);
                } else {
                    await client.sendMessage(from, '❌ Opción no válida. Por favor, selecciona una letra válida de las opciones mostradas.');
                }
                break;

            case 'combos':
                if (['1', '2', '3'].includes(messageBody)) {
                    await transferToAgent(from, customerName);
                } else {
                    await client.sendMessage(from, '❌ Opción no válida. Por favor, selecciona un número de combo válido (1-3).');
                }
                break;

            default:
                // Si el estado es desconocido, volver al menú principal
                state.stage = 'menu';
                await sendMainMenu(from, customerName);
        }

        // Programar chequeo de inactividad
        setTimeout(() => handleInactivity(from), 120000);
    });

    client.on('qr', (code) => {
        qr = code;
        console.log('Nuevo código QR generado');
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'qr', code: qr }));
            }
        });
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('Cliente WhatsApp listo');
        qr = null;
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'ready' }));
            }
        });
    });

    client.on('authenticated', () => {
        console.log('Cliente autenticado');
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'authenticated' }));
            }
        });
    });

    client.on('disconnected', (reason) => {
        console.log('Cliente WhatsApp desconectado:', reason);
        qr = null;
        chatStates.clear();
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ 
                    type: 'disconnected',
                    reason: reason 
                }));
            }
        });
    });

    return client;
};

// Rutas de Express
app.get('/', (req, res) => {
    res.send('ANM Bot Server Running');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        clientActive: client !== null,
        websocketConnections: wss.clients.size
    });
});

// WebSocket handling
wss.on('connection', (ws) => {
    console.log('Nueva conexión establecida');

    if (qr) {
        ws.send(JSON.stringify({ type: 'qr', code: qr }));
    }

    if (client && client.info) {
        ws.send(JSON.stringify({ type: 'ready' }));
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);

            switch (data.type) {
                case 'start':
                    if (!client) {
                        client = createWhatsAppClient();
                        await client.initialize();
                    }
                    break;

                case 'stop':
                    if (client) {
                        await client.destroy();
                        client = null;
                        qr = null;
                        chatStates.clear();
                    }
                    break;

                case 'reset':
                    if (client) {
                        await client.destroy();
                    }
                    chatStates.clear();
                    client = createWhatsAppClient();
                    await client.initialize();
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                case 'getState':
                    if (client && client.info) {
                        ws.send(JSON.stringify({ type: 'ready' }));
                    } else if (qr) {
                        ws.send(JSON.stringify({ type: 'qr', code: qr }));
                    }
                    break;
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: error.message 
            }));
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado');
    });

    ws.on('error', (error) => {
        console.error('Error en WebSocket:', error);
    });
});

process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Promesa rechazada no manejada:', error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
