import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";
import ReactMarkdown from "react-markdown";

// --- Types ---

type Option = {
    label: string;
    value: string;
    sub?: string;
};

type FormField = {
    id: string;
    type: "text" | "select" | "radio" | "checkbox";
    label: string;
    placeholder?: string;
    defaultValue?: string; 
    options?: string[];
    max_select?: number; 
};

type FormSchema = {
    titulo: string;
    fields: FormField[];
};

type PregenCharacter = {
    id: string;
    nome: string;
    raca: string;
    classe: string;
    stats: { for: number; des: number; con: number; int: number; sab: number; car: number };
    hp: number;
    equip: string[];
    desc: string;
    role: string; // Tank, DPS, Healer, Utility
};

type ItemObtainedData = {
    item_name: string;
    quantity: number;
    description: string;
    rarity?: "common" | "uncommon" | "rare" | "legendary";
    icon?: "weapon" | "potion" | "armor" | "misc";
};

type DiceRollData = {
    roll_name: string;
    d20_result: number;
    modifier: number;
    proficiency: number;
    total_value: number;
    is_critical: boolean;
    is_success: boolean;
};

type CombatHitData = {
    target: string;
    damage: number;
    damage_type: string;
    is_critical: boolean;
};

type GameEvent = {
    type: "none" | "dice_roll" | "combat_hit" | "item_obtained";
    data: DiceRollData | CombatHitData | ItemObtainedData | any;
};

type Combatant = {
    name: string;
    hp: number;
    max_hp: number;
    is_active: boolean;
    avatar?: string;
};

type CombatState = {
    round: number;
    turn_order: Combatant[];
};

// Interface atualizada para Membros do Grupo
interface GroupMember {
  nome: string;
  classe: string;
  status: string; // "Vivo", "Ferido", "Inconsciente"
  avatar?: string;
  raca?: string; 
}

interface Quest {
  id: string;
  titulo: string;
  descricao: string;
  status: "ativa" | "completa" | "falha";
}

type GameStatus = {
    nome: string;
    titulo: string;
    hp_atual: number;
    hp_max: number;
    armor_class: number;
    local: string;
    missao: string;
    inventario: string[];
    atributos?: Record<string, string>;
    combat?: CombatState;
    avatarUrl?: string;
    grupo?: GroupMember[]; 
    talentos?: string[]; 
    missoes_ativas?: Quest[];
    // Sistema de Facções Expandido (Política de Guerra)
    reputacao?: { 
        thyatis: number; 
        traladara: number;
        igreja_karameikos?: number;
        ordem_grifo?: number;
        elfos_callarii?: number;
    }; 
    pistas_descobertas?: string[]; // Sistema de Mistério
};

type GameResponse = {
    narrative: string;
    status_jogador?: Partial<GameStatus>;
    combat_state?: CombatState;
    game_event?: GameEvent;
    quick_actions?: string[];
    update_avatar?: { trigger: boolean; visual_prompt: string };
    
    // Engine de Cenários
    update_scene?: { 
        trigger: boolean; 
        visual_prompt: string; 
        style?: string; 
    };
    
    interface?: {
        modo: "texto_livre" | "botoes" | "rolagem" | "formulario" | "selecao_fichas";
        permitir_input_livre?: boolean;
        conteudo?: Option[] | FormSchema; 
    };
};

type Message = {
    id: string;
    role: "user" | "model" | "system";
    text: string;
    gameResponse?: GameResponse;
    options?: Option[];
    imageUrl?: string;
    form?: FormSchema;
    showPregen?: boolean;
};

// --- Constants ---

const MODEL_NAME = "gemini-2.5-flash";
const TTS_MODEL_NAME = "gemini-2.5-flash-preview-tts";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image";

// Dados extraídos do PDF "Mystara - Karameikos Fichas" e adaptados para 5e
const PREGEN_CHARACTERS: PregenCharacter[] = [
    {
        id: "001",
        nome: "Valerius Vorloi",
        raca: "Humano (Thyatiano)",
        classe: "Guerreiro (Cavaleiro)",
        stats: { for: 16, des: 10, con: 15, int: 10, sab: 13, car: 14 },
        hp: 12,
        equip: ["Espada Longa", "Escudo com Brasão", "Cota de Malhas", "Kit de Viajante"],
        desc: "Nobreza decaída, busca restaurar a honra da família. Disciplinado e leal ao Duque.",
        role: "🛡️ Tanque / Defensivo"
    },
    {
        id: "002",
        nome: "Dmitri Torenescu",
        raca: "Humano (Traladarano)",
        classe: "Ladino (Lâmina)",
        stats: { for: 10, des: 16, con: 12, int: 14, sab: 13, car: 15 },
        hp: 9,
        equip: ["Rapieira", "Adaga Curva", "Armadura de Couro", "Baralho de Tarokka"],
        desc: "Cresceu nas ruas do 'Ninho'. Odeia a guarda da cidade. Rápido e mortal.",
        role: "🗡️ Furtivo / Dano Rápido"
    },
    {
        id: "003",
        nome: "Syllina Argenthos",
        raca: "Humana (Traladarana)",
        classe: "Clérigo (Igreja de Karameikos)",
        stats: { for: 13, des: 10, con: 14, int: 12, sab: 16, car: 14 },
        hp: 10,
        equip: ["Maça Estrela", "Cota de Escamas", "Símbolo Sagrado", "Unguentos"],
        desc: "Missionária tentando apaziguar os ânimos entre os povos. Cura aliados e bane mortos-vivos.",
        role: "❤️ Suporte / Cura"
    },
    {
        id: "004",
        nome: "Elara de Callarii",
        raca: "Elfa (Floresta)",
        classe: "Mago (Evocação)",
        stats: { for: 8, des: 16, con: 12, int: 17, sab: 14, car: 10 },
        hp: 7,
        equip: ["Cajado de Carvalho", "Grimório Élfico", "Adaga", "Manto Verde"],
        desc: "Uma emissária dos elfos de Radlebb. Sua magia é tão bela quanto mortal.",
        role: "🔥 Controle Arcano"
    },
    {
        id: "005",
        nome: "Thorin Escudo-de-Ferro",
        raca: "Anão (Forte)",
        classe: "Guerreiro (Campeão)",
        stats: { for: 17, des: 13, con: 16, int: 10, sab: 12, car: 8 },
        hp: 13,
        equip: ["Machado de Batalha", "Machadinha", "Cota de Malhas Pesada"],
        desc: "Um mercenário das Montanhas Cruth. Fala pouco, bate forte.",
        role: "⚔️ Dano Pesado"
    }
];

const SYSTEM_INSTRUCTION = `
**PERSONA:**
Você é um Motor de Jogo (Game Engine) e Mestre de RPG narrando a campanha "Tirania dos Dracos em Karameikos" (D&D 5e).
Seu estilo é "Grim Dark Fantasy" com foco em **GUERRA, CAOS e ESCOLHAS MORAIS**.

**ROTEIRO DE INÍCIO (EM CHAMAS - BASEADO EM GREENEST):**
1. **O ATAQUE:** O jogo começa *in media res*. Threshold está sob ataque. O céu está vermelho. Um Dragão Azul Adulto (Lennithon) destrói as defesas com relâmpagos.
2. **OS INVASORES:** Kobolds e Cultistas (Garras de Dragão) invadem casas. Eles NÃO querem ouro, eles buscam "A Relíquia" (Dracos/Ovos).
3. **A ESCOLHA CRÍTICA:** O jogador vê duas cenas simultâneas e deve escolher IMEDIATAMENTE:
   - **Cena A:** Uma família Traladarana encurralada por Kobolds sádicos.
   - **Cena B:** A carruagem do Barão Sherlane Halaran sendo destruída pelo Meio-Dragão Langdedrosa Cyanwrath (Campeão do Culto).
4. **DEFINIÇÃO DE CLASSE & ALIANÇA:**
   - Salvar a Família = Aliança com Traladara (+1) / Inimizade com Thyatis (-1). Define classes protetoras (Paladino, Clérigo).
   - Salvar o Barão = Aliança com Thyatis (+1) / Inimizade com Traladara (-1). Define classes marciais/arcanas (Guerreiro, Mago).
   - Caçar nas Sombras = Neutro / Ordem do Grifo. Define classes furtivas (Ladino, Patrulheiro).

**PROTOCOLO DE CRIAÇÃO DE PERSONAGEM (FORMULÁRIO):**
Para ativar a ficha, envie a interface com \`modo: "formulario"\` e a estrutura exata abaixo:
\`\`\`json
"interface": {
    "modo": "formulario",
    "conteudo": {
        "titulo": "Criação de Personagem",
        "fields": [
            { "id": "nome", "type": "text", "label": "Nome", "placeholder": "Nome do Herói" },
            { "id": "raca", "type": "select", "label": "Raça", "options": ["Humano", "Anão", "Elfo", "Pequenino", "Draconato", "Gnomo", "Meio-Elfo", "Meio-Orc", "Tiefling"] },
            { "id": "classe", "type": "select", "label": "Classe", "options": ["Guerreiro", "Paladino", "Ladino", "Clérigo", "Mago", "Patrulheiro", "Bardo", "Druida", "Feiticeiro", "Bruxo", "Monge", "Bárbaro"] },
            { "id": "atributos", "type": "select", "label": "Geração de Atributos", "options": ["Padrão", "Compra de Pontos", "Rolagem"] },
            { "id": "visual_style", "type": "text", "label": "Estilo Visual", "placeholder": "Ex: Guerreiro com cicatriz, armadura gasta, pintura a óleo." }
        ]
    }
}
\`\`\`
**IMPORTANTE:** Use a descrição do "Estilo Visual" para gerar um \`update_avatar\` preciso imediatamente após o jogador enviar o formulário.

**HIERARQUIA DO CULTO (TIRANIA DOS DRAGÕES):**
Use os ranques oficiais do culto para descrever inimigos:
1. **Garras de Dragão (Dragonclaws):** Fanáticos de baixo nível, usam roupas de couro preto e máscaras simples.
2. **Asas de Dragão (Dragonwings):** Voam com capas planadoras, atacam de cima.
3. **Oradores da Wyrm (Wyrmspeakers):** Os líderes que portam as Máscaras do Dragão. Eles conseguem "sentir" onde o jogador está se ele estiver carregando um Draco.

**VILÃO INICIAL:**
**Langdedrosa Cyanwrath:** O Campeão Meio-Dragão Azul. Honrado mas brutal. Ele busca um duelo digno e persegue o jogador no início.

**SISTEMA DE CONSELHO (POLÍTICA DE GUERRA):**
Mantenha um placar político oculto em 'reputacao'.
- **Thyatis (Nobreza):** Lei e Ordem.
- **Traladara (Povo):** Tradição e Comunidade.
- **Igreja:** Fé e Pureza.
- **Grifo:** Força Militar.
- **Elfos:** Natureza e Magia.
*Regra:* Se uma facção chegar a -3, eles retiram apoio na guerra final.
*Feedback:* NPCs reagem com hostilidade (recusa de ajuda) ou gratidão baseado nisso.

**REGRAS DE OURO:**
1. **JSON OBRIGATÓRIO:** Toda resposta termina com \`--- [JSON_DATA] ---\`.
2. **SHOW, DON'T TELL:** O cheiro de ozônio, o grito do dragão, o calor do fogo. Use descrições sensoriais intensas.
3. **DADOS:** Em combate, use o sistema de DiceRoll para ataques e danos.

**SCHEMA JSON DE RESPOSTA:**
\`\`\`json
{
  "narrative": "Texto narrativo...",
  "game_event": { "type": "none", "data": {} },
  "status_jogador": { 
      "nome": "Voron", 
      "titulo": "Sobrevivente",
      "hp_atual": 10, 
      "hp_max": 10,
      "armor_class": 10,
      "local": "Threshold (Em Chamas)",
      "missao": "Sobreviver",
      "inventario": [],
      "grupo": [],
      "reputacao": { 
          "thyatis": 0, 
          "traladara": 0,
          "igreja_karameikos": 0,
          "ordem_grifo": 0,
          "elfos_callarii": 0
      },
      "pistas_descobertas": []
  },
  "combat_state": { "round": 0, "turn_order": [] },
  "update_scene": { "trigger": false, "visual_prompt": "" },
  "update_avatar": { "trigger": false, "visual_prompt": "" },
  "interface": { "modo": "botoes", "conteudo": [] }
}
\`\`\`
`;

// Mensagem inicial com o Menu Principal contextualizado
const INITIAL_MESSAGE: Message = {
    id: 'intro',
    role: 'model',
    text: "O céu noturno sobre Threshold não é preto, é vermelho-sangue. O rugido ensurdecedor de um dragão abala os ossos do seu peito, seguido pelo som de madeira estilhaçando quando a torre do sino da igreja desmorona.\n\nVocê corre pelas ruas em pânico. Kobolds sibilantes saltam das sombras, incendiando casas com tochas. Mas eles não estão saqueando... eles estão *procurando*.\n\n— *Achem o Portador!* — ruge uma voz profunda. No centro da praça, um Meio-Dragão de dois metros de altura, vestindo armadura roxa, ergue um plebeu pelo pescoço com uma mão. — *Onde está a Caixa de Ferro?!*\n\nO caos é total. À sua esquerda, um grupo de guardas tenta proteger a entrada do Solar do Barão. À sua direita, civis fogem para o rio, perseguidos por cultistas.\n\nNo meio desse inferno, quem é você?",
    options: [
        { 
            label: "O Defensor do Povo", 
            value: "Eu me lanço para proteger os civis no rio. (Defina minha classe como Paladino ou Clérigo e inicie combate com Kobolds)" 
        },
        { 
            label: "O Soldado do Barão", 
            value: "Corro para reforçar a guarda no Solar. (Defina minha classe como Guerreiro ou Patrulheiro e inicie combate tático)" 
        },
        { 
            label: "O Oportunista Sombrio", 
            value: "Uso o caos para me esgueirar e observar o Meio-Dragão. (Defina minha classe como Ladino ou Mago e faça um teste de Furtividade)" 
        }
    ],
    gameResponse: {
        narrative: "O céu noturno...",
        status_jogador: { 
            nome: "Desconhecido", 
            titulo: "Sobrevivente", 
            hp_atual: 10, 
            hp_max: 10, 
            armor_class: 10,
            local: "Threshold (Em Chamas)", 
            missao: "Sobreviver ao Ataque do Culto", 
            inventario: ["Arma Inicial"],
            grupo: [],
            reputacao: { 
                thyatis: 0, 
                traladara: 0,
                igreja_karameikos: 0,
                ordem_grifo: 0,
                elfos_callarii: 0
            },
            pistas_descobertas: []
        },
        combat_state: {
             round: 1,
             turn_order: [
                 {name: "Herói", hp: 10, max_hp: 10, is_active: true},
                 {name: "Kobold Saqueador", hp: 5, max_hp: 5, is_active: false}
             ]
        },
        update_scene: {
            trigger: true,
            visual_prompt: "Cinematic wide shot of a medieval town at night engulfed in flames. An Adult Blue Dragon flies overhead against a blood-red sky, breathing lightning. Chaos in the streets, burning houses. Dark fantasy art style, dramatic lighting.",
            style: "Cinematic Action"
        },
        interface: { 
            modo: "botoes", 
            permitir_input_livre: true,
            conteudo: [
                { label: "O Defensor do Povo", value: "Eu me lanço para proteger..." },
                { label: "O Soldado do Barão", value: "Corro para reforçar..." },
                { label: "O Oportunista Sombrio", value: "Uso o caos..." }
            ] 
        }
    }
};

const INITIAL_BUTTONS = INITIAL_MESSAGE.options!;

// --- Helper Functions ---

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodePCM(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const byteLength = data.length;
  // Ensure buffer length is even for Int16Array
  if (byteLength % 2 !== 0) {
      const newData = new Uint8Array(byteLength + 1);
      newData.set(data);
      data = newData;
  }

  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Components ---

const DividerDecoration = () => (
    <div className="flex items-center justify-center my-4 opacity-30">
        <div className="h-px bg-stone-500 w-1/4"></div>
        <div className="px-2 text-stone-500 font-serif">❦</div>
        <div className="h-px bg-stone-500 w-1/4"></div>
    </div>
);

// 1. Dice Result Card (Detailed Math)
const DiceResultCard = ({ data }: { data: DiceRollData }) => {
  if (!data) return null;

  const isCrit = data.is_critical;
  const isFail = data.d20_result === 1;
  
  let borderColor = data.is_success ? 'border-green-500/50' : 'border-red-600/50';
  let glowClass = '';
  let textColor = data.is_success ? 'text-green-400' : 'text-red-400';

  if (isCrit) {
      borderColor = 'border-amber-400';
      glowClass = 'shadow-[0_0_20px_rgba(251,191,36,0.2)] animate-pulse';
      textColor = 'text-amber-400';
  } else if (isFail) {
      borderColor = 'border-stone-600';
      glowClass = 'animate-shake grayscale';
      textColor = 'text-stone-500';
  }

  return (
    <div className={`relative w-full max-w-sm mx-auto my-4 bg-gray-900/90 backdrop-blur-sm rounded-lg border-2 ${borderColor} ${glowClass} p-4 animate-fade-in`}>
      <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
        <span className="text-stone-400 text-xs font-bold uppercase tracking-widest">{data.roll_name}</span>
        {isCrit && <span className="text-amber-400 text-xs font-bold">CRÍTICO!</span>}
        {isFail && <span className="text-stone-500 text-xs font-bold">FALHA CRÍTICA</span>}
      </div>
      <div className="flex flex-col items-center">
        <div className={`w-16 h-16 flex items-center justify-center rounded-full mb-2 shadow-inner border border-white/10 ${isCrit ? 'bg-amber-900/40' : 'bg-gray-800'}`}>
          <span className={`text-3xl font-black ${isCrit ? 'text-amber-100' : 'text-white'}`}>{data.d20_result}</span>
        </div>
        <div className="flex gap-2 text-xs md:text-sm text-stone-500 font-mono mb-1">
           <span title="Dado">[{data.d20_result}]</span>
           <span title="Modificador">+ {data.modifier}</span>
           <span title="Proficiência">+ {data.proficiency}</span>
        </div>
        <div className={`text-2xl font-bold ${textColor} drop-shadow-md`}>
          = {data.total_value}
        </div>
      </div>
    </div>
  );
};

const GameEventCard = ({ event }: { event: GameEvent }) => {
    if (!event || event.type === 'none') return null;
    if (event.type === 'dice_roll') return <DiceResultCard data={event.data as DiceRollData} />;

    let cardStyle = "border-stone-700 bg-stone-900/90";
    let icon = "✨";
    let title = "Evento";
    let mainValue = "";
    let subValue = "";

    if (event.type === 'combat_hit') {
        const data = event.data as CombatHitData;
        cardStyle = "border-red-900/60 bg-gradient-to-br from-red-950/90 to-black animate-shake";
        icon = "⚔️";
        title = "Dano Recebido";
        mainValue = `-${data.damage}`;
        subValue = `${data.damage_type} em ${data.target}`;
    } else if (event.type === 'item_obtained') {
        const data = event.data as ItemObtainedData;
        cardStyle = "border-yellow-700/50 bg-gradient-to-br from-yellow-950/40 to-black animate-fade-in";
        icon = "🎒";
        title = "Item Obtido";
        mainValue = `${data.quantity}x ${data.item_name}`;
        subValue = data.description;
    }

    return (
        <div className={`mt-4 mx-auto max-w-sm rounded-lg border-2 p-4 flex items-center justify-between shadow-xl backdrop-blur-sm ${cardStyle}`}>
            <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-70 mb-1 flex items-center gap-1">
                    {icon} {title}
                </span>
                <span className="text-xs text-stone-400 font-serif italic">{subValue}</span>
            </div>
            <div className="flex flex-col items-end">
                <span className="text-xl font-fantasy font-bold text-stone-200">{mainValue}</span>
            </div>
        </div>
    );
};

const LootToast = ({ item }: { item: ItemObtainedData }) => (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#2a2622] border-2 border-yellow-700 text-yellow-100 px-6 py-4 rounded shadow-2xl animate-fade-in-down flex items-center gap-4">
        <div className="text-4xl">{item.icon === 'potion' ? '🧪' : item.icon === 'weapon' ? '⚔️' : item.icon === 'armor' ? '🛡️' : '🎒'}</div>
        <div>
            <h4 className="font-fantasy text-lg text-yellow-500 uppercase tracking-widest">Item Obtido</h4>
            <p className="font-serif text-xl">{item.item_name}</p>
        </div>
    </div>
);

const CombatTracker = ({ combatState }: { combatState: CombatState }) => (
    <div className="bg-red-950/90 border-b-4 border-red-900 p-4 shadow-lg mb-4">
        <div className="flex justify-between items-center mb-2">
            <h3 className="text-red-300 font-fantasy text-xl uppercase tracking-widest">Combate - Turno {combatState.round}</h3>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
            {combatState.turn_order.map((combatant, idx) => (
                <div key={idx} className={`bg-black/50 p-2 rounded border min-w-[120px] ${combatant.is_active ? 'border-amber-500' : 'border-red-800/50 opacity-70'}`}>
                    <div className="font-bold text-stone-300 text-sm truncate">{combatant.name}</div>
                    <div className="w-full bg-stone-800 h-2 mt-1 rounded-full overflow-hidden">
                        <div 
                            className="bg-red-600 h-full transition-all" 
                            style={{ width: `${Math.max(0, Math.min(100, (combatant.hp / combatant.max_hp) * 100))}%` }}
                        ></div>
                    </div>
                    <div className="text-xs text-right text-stone-500 mt-0.5">{combatant.hp}/{combatant.max_hp}</div>
                </div>
            ))}
        </div>
    </div>
);

const MessageItem: React.FC<{ msg: Message, isLast: boolean }> = ({ msg, isLast }) => {
    const [isTextVisible, setIsTextVisible] = useState(true);
    const hasImage = !!msg.imageUrl;

    return (
        <div className={`mb-6 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
                className={`rounded-lg shadow-xl relative transition-all duration-500 ${
                    msg.role === 'user' 
                    ? 'bg-[#2a2622] text-[#d1c4b2] border border-[#3e352f] max-w-[90%] p-5' 
                    : `bg-[#1e1c19] text-[#e8e6e3] border border-[#3e352f] w-full ${isTextVisible ? 'max-w-4xl p-5' : 'max-w-5xl p-0 border-none bg-transparent'}`
                }`}
            >
                {/* Immersion Toggle Button */}
                {hasImage && msg.role === 'model' && (
                    <button 
                        onClick={() => setIsTextVisible(!isTextVisible)}
                        className="absolute top-2 right-2 z-20 bg-black/60 hover:bg-yellow-900/80 text-stone-300 p-2 rounded-full border border-stone-600 backdrop-blur-md transition-all"
                        title="Modo Imersivo"
                    >
                        {isTextVisible ? 
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            : 
                            <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg>
                        }
                    </button>
                )}

                {msg.role === 'model' && isTextVisible && <div className="absolute top-0 left-0 w-1 h-full bg-yellow-900/50 rounded-l-lg"></div>}
                
                {msg.imageUrl && (
                    <div className={`relative group ${isTextVisible ? 'mb-4 rounded border border-[#3e352f] shadow-inner overflow-hidden' : 'rounded-xl shadow-2xl border-2 border-yellow-900/30 overflow-hidden'}`}>
                        <img 
                            src={msg.imageUrl} 
                            alt="Visualização da Cena" 
                            className={`w-full h-auto object-cover transition-all duration-700 ${isTextVisible ? 'max-h-[400px]' : 'max-h-[85vh]'}`} 
                        />
                         {/* IMMERSIVE STAT OVERLAY */}
                         {!isTextVisible && msg.gameResponse?.status_jogador?.atributos && (
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-12 pb-6 px-6 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex justify-center gap-8 items-end">
                                <h3 className="font-fantasy text-yellow-500 text-2xl shadow-black drop-shadow-md border-r border-stone-600 pr-6">
                                    {msg.gameResponse.status_jogador.nome}
                                </h3>
                                <div className="flex gap-4">
                                    {Object.entries(msg.gameResponse.status_jogador.atributos).map(([key, val]) => (
                                        <div key={key} className="flex flex-col items-center">
                                            <span className="text-stone-500 text-[10px] uppercase font-bold tracking-widest">{key}</span>
                                            <span className="text-stone-200 font-fantasy text-xl">{val}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {isTextVisible && (
                    <div className="font-serif leading-relaxed text-lg whitespace-pre-wrap">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                        {msg.role === 'model' && msg.gameResponse?.game_event && (
                             <GameEventCard event={msg.gameResponse.game_event} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// Component for Selecting Pre-generated Characters
const PregenSelector = ({ onSelect }: { onSelect: (char: PregenCharacter) => void }) => {
    return (
        <div className="bg-[#1e1c19] border border-stone-700 p-6 rounded-lg max-w-5xl mx-auto my-6 shadow-2xl animate-fade-in">
            <h3 className="font-fantasy text-2xl text-yellow-600 mb-2 text-center tracking-widest">Lendas de Karameikos</h3>
            <p className="text-center text-stone-400 mb-6 font-serif italic">Escolha um herói pronto para iniciar sua jornada imediatamente.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {PREGEN_CHARACTERS.map((char) => (
                    <div 
                        key={char.id} 
                        onClick={() => onSelect(char)}
                        className="group relative bg-[#141210] border border-stone-600 hover:border-yellow-600 rounded-lg p-4 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl overflow-hidden flex flex-col"
                    >
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80 pointer-events-none"></div>
                        <div className="absolute top-0 right-0 p-2 text-[10px] font-bold uppercase tracking-wider bg-stone-800 text-stone-300 rounded-bl-lg border-b border-l border-stone-600">
                           {char.role}
                        </div>

                        <div className="mb-3 relative z-10">
                            <h4 className="text-xl font-fantasy text-yellow-500 group-hover:text-yellow-400 transition-colors">{char.nome}</h4>
                            <span className="text-xs uppercase tracking-widest text-stone-400">{char.raca} | {char.classe}</span>
                        </div>

                        <div className="grid grid-cols-6 gap-1 mb-4 text-center relative z-10">
                            {Object.entries(char.stats).map(([stat, val]) => (
                                <div key={stat} className="bg-stone-900/80 rounded p-1 border border-stone-800">
                                    <span className="block text-[9px] uppercase font-bold text-stone-500">{stat}</span>
                                    <span className={`block font-bold ${val > 15 ? 'text-yellow-500' : 'text-stone-300'}`}>{val}</span>
                                </div>
                            ))}
                        </div>

                        <p className="text-sm text-stone-300 font-serif italic mb-4 flex-1 relative z-10 line-clamp-3">"{char.desc}"</p>

                        <div className="text-[10px] text-stone-500 relative z-10">
                            <strong className="text-stone-400">Equip:</strong> {char.equip.join(", ")}
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="mt-6 text-center">
                 <button onClick={() => onSelect({ id: 'manual', nome: 'Criar Novo', raca: '', classe: '', stats: {} as any, hp: 0, equip: [], desc: '', role: '' })} className="text-stone-500 hover:text-stone-300 underline text-sm">
                     Voltar e criar ficha manualmente
                 </button>
            </div>
        </div>
    );
};


// Advanced Dynamic Form with Point Buy & Dice Logic
const DynamicForm = ({ schema, onSubmit, context }: { schema: FormSchema | any, onSubmit: (v: any) => void, context: any }) => {
    const [formData, setFormData] = useState<any>({});
    const [pointsUsed, setPointsUsed] = useState(0);

    // Robust schema normalization
    const safeFields = Array.isArray(schema) ? schema : (schema?.fields || []);
    const safeTitle = Array.isArray(schema) ? "Formulário" : (schema?.titulo || "");

    // Initialize defaults from schema if available
    useEffect(() => {
        if (safeFields.length > 0) {
            const defaults: any = {};
            safeFields.forEach((f: any) => {
                if (f.defaultValue) defaults[f.id] = f.defaultValue;
            });
            setFormData((prev: any) => ({ ...defaults, ...prev }));
        }
    }, [schema, safeFields]); 

    const STAT_IDS = ['for', 'des', 'con', 'int', 'sab', 'car'];
    
    // Auto-detect methodology based on previously selected fields or context
    const isPointBuy = formData['atributos']?.includes('Compra') || context?.method?.includes('Compra');
    const isRolling = formData['atributos']?.includes('Rolagem') || context?.method?.includes('Rolagem');

    const getPointCost = (val: number) => {
        if (val < 8) return 0;
        if (val === 8) return 0;
        if (val === 9) return 1;
        if (val === 10) return 2;
        if (val === 11) return 3;
        if (val === 12) return 4;
        if (val === 13) return 5;
        if (val === 14) return 7;
        if (val === 15) return 9;
        return 999;
    };

    useEffect(() => {
        if (isPointBuy) {
            let total = 0;
            STAT_IDS.forEach(stat => {
                const val = parseInt(formData[stat] || "8");
                if (!isNaN(val)) total += getPointCost(val);
            });
            setPointsUsed(total);
        }
    }, [formData, isPointBuy]);

    const handleInputChange = (id: string, value: string) => {
        setFormData((prev: any) => ({ ...prev, [id]: value }));
    };

    // Show error if absolutely no fields found even after normalization attempt
    if (!safeFields || safeFields.length === 0) {
         return (
            <div className="bg-red-900/30 border border-red-700 p-4 rounded-lg my-4 text-center">
                <p className="text-red-300 font-bold mb-1">Erro Arcano (Schema Vazio)</p>
                <p className="text-xs text-red-400/80 italic">O Mestre enviou um pergaminho em branco. Tente outra ação.</p>
            </div>
        );
    }

    return (
        <div className="bg-[#1e1c19] border border-stone-700 p-6 rounded-lg max-w-2xl mx-auto my-6 shadow-2xl animate-fade-in">
            {safeTitle && <h3 className="font-fantasy text-2xl text-yellow-600 mb-6 text-center tracking-widest">{safeTitle}</h3>}
            
            {/* Contextual Header for Point Buy */}
            {isPointBuy && (
                 <div className={`mb-4 p-3 border rounded-lg transition-colors ${pointsUsed > 27 ? 'bg-red-900/20 border-red-500/50' : 'bg-emerald-900/30 border-emerald-500/50'}`}>
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400">Pontos Usados</span>
                        <span className={`text-xl font-bold font-mono ${pointsUsed > 27 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {pointsUsed} / 27
                        </span>
                    </div>
                    <div className="h-1.5 bg-black rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-300 ${pointsUsed > 27 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min((pointsUsed / 27) * 100, 100)}%` }}></div>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                {safeFields.map((field: FormField, idx: number) => {
                    const isStat = STAT_IDS.includes(field.id);
                    
                    if (isStat && isRolling) {
                        return (
                            <div key={idx} className="flex justify-between items-center bg-black/30 p-3 rounded border border-indigo-900/30">
                                <label className="text-indigo-300 text-xs font-bold uppercase">{field.label}</label>
                                <div className="text-indigo-500 font-fantasy text-lg animate-pulse">?</div>
                            </div>
                        );
                    }

                    return (
                        <div key={idx} className="flex flex-col gap-1">
                            <label className="text-xs uppercase font-bold text-stone-500">{field.label}</label>
                            {field.type === 'select' ? (
                                <select 
                                    className="bg-black/40 border border-stone-700 text-stone-300 p-2 rounded focus:border-yellow-700 outline-none"
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                                >
                                    <option value="">Selecione...</option>
                                    {field.options?.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
                                </select>
                            ) : field.type === 'radio' ? (
                                <div className="flex flex-col gap-2">
                                    {field.options?.map((opt, i) => (
                                        <label key={i} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1 rounded">
                                            <input type="radio" name={field.id} checked={formData[field.id] === opt} onChange={() => handleInputChange(field.id, opt)} className="accent-yellow-600" />
                                            <span className="text-sm text-stone-300">{opt}</span>
                                        </label>
                                    ))}
                                </div>
                            ) : (
                                <div className="relative">
                                    <input 
                                        type={isStat && isPointBuy ? "number" : "text"}
                                        min={isPointBuy ? "8" : undefined}
                                        max={isPointBuy ? "15" : undefined}
                                        className="w-full bg-black/40 border border-stone-700 text-stone-300 p-2 rounded focus:border-yellow-700 outline-none"
                                        value={formData[field.id] || ''}
                                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                                        placeholder={field.placeholder || ''} 
                                    />
                                    {isStat && isPointBuy && <span className="absolute right-2 top-2 text-[10px] text-stone-500">-{getPointCost(parseInt(formData[field.id] || "8"))}pts</span>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <button 
                onClick={() => onSubmit(formData)}
                disabled={isPointBuy && pointsUsed > 27}
                className={`w-full mt-8 py-3 rounded font-bold uppercase tracking-widest transition-colors ${isPointBuy && pointsUsed > 27 ? 'bg-red-900/20 text-red-500 border border-red-800 cursor-not-allowed' : 'bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-500 border border-yellow-800/50'}`}
            >
                {isPointBuy && pointsUsed > 27 ? "Excesso de Pontos" : "Confirmar"}
            </button>
        </div>
    );
};