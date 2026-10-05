import type { GapLevel } from "./case";

/**
 * Investigation-driven knowledge base: for each scenario, the information the first
 * record must capture, the follow-up question that obtains it and the investigative
 * action it enables. The model only suggests gaps grounded in these items.
 *
 * Draft content for the prototype. Every item must be reviewed by the partner
 * detectives before it is relied on.
 */
export type KnowledgeItem = {
	id: string;
	field: string;
	level: GapLevel;
	question: string;
	use: string;
	/** Values worth checking against the victim's own screenshots / receipts. */
	verifyWith?: string;
};

export type KnowledgeScenario = {
	id: string;
	group: "common" | "contact" | "delivery" | "fraud";
	name: string;
	/** When the scenario applies, in plain words for the model. */
	appliesWhen: string;
	items: KnowledgeItem[];
};

export const KNOWLEDGE_BASE: KnowledgeScenario[] = [
	{
		id: "common",
		group: "common",
		name: "所有詐欺案件",
		appliesWhen: "每一件詐欺案件",
		items: [
			{ id: "first-contact", field: "初次接觸時間與管道", level: "must", question: "第一次跟對方接觸是哪一天？透過什麼管道？", use: "確立犯罪時間序列，判斷管轄與追訴起點" },
			{ id: "discovery", field: "發現受騙的時間與經過", level: "must", question: "您是什麼時候、因為什麼事情發現被騙？", use: "確立犯罪事實與報案時效" },
			{
				id: "each-payment",
				field: "每一筆交付的時間、金額、方式",
				level: "must",
				question: "總共給了幾次錢？每一次是哪一天、多少錢、用什麼方式？",
				use: "構成要件「交付財物」，逐筆建立金流",
				verifyWith: "轉帳紀錄"
			},
			{ id: "total-loss", field: "總損害金額與各筆是否相符", level: "must", question: "總共損失多少？跟剛剛每一筆加起來對得上嗎？", use: "避免筆錄前後矛盾，供移送書計算損害" },
			{ id: "evidence-kept", field: "可提供的證物", level: "lead", question: "對話紀錄、轉帳截圖、收據這些現在都還在嗎？可以提供嗎？", use: "隨筆錄附卷，供後續調閱與比對" },
			{ id: "still-contact", field: "是否仍與對方聯絡", level: "add", question: "現在還有跟對方聯絡嗎？對方知道您來報案嗎？", use: "評估誘捕可能性與被害人後續風險" },
			{ id: "secondary", field: "是否有人聲稱可協助追回款項", level: "add", question: "報案前後，有沒有人說可以幫您把錢追回來？", use: "防範二次詐騙，可能涉及另案" }
		]
	},
	{
		id: "contact",
		group: "contact",
		name: "通訊聯絡",
		appliesWhen: "對方以電話、通訊軟體、社群或網站與被害人聯絡",
		items: [
			{ id: "phone", field: "對方電話號碼", level: "lead", question: "對方打給您的電話號碼是多少？來電有沒有顯示國際碼？", use: "調閱通聯紀錄、比對其他案件", verifyWith: "手機通話紀錄畫面" },
			{
				id: "messenger-id",
				field: "通訊軟體帳號（LINE ID／Telegram／暱稱）",
				level: "lead",
				question: "對方的 LINE ID 或 Telegram 帳號是什麼？暱稱和頭像是什麼？",
				use: "函調帳號註冊資料、比對系列案件",
				verifyWith: "對話截圖"
			},
			{ id: "group-name", field: "群組名稱與人數", level: "add", question: "您被拉進的群組叫什麼名字？大概有多少人？", use: "辨識同一集團的話術群組" },
			{ id: "site-app", field: "網站網址或 APP 名稱與下載來源", level: "lead", question: "對方叫您用的網站網址或 APP 名稱是什麼？從哪裡下載的？", use: "調閱網域註冊與主機資料、通報下架" },
			{ id: "ad-source", field: "廣告或貼文來源", level: "add", question: "一開始看到的廣告或貼文是在哪個平台？還找得到嗎？", use: "通報平台、追查廣告投放帳號" }
		]
	},
	{
		id: "bank-transfer",
		group: "delivery",
		name: "銀行轉帳／ATM 轉帳",
		appliesWhen: "被害人以網路銀行、臨櫃或 ATM 轉帳、匯款",
		items: [
			{
				id: "payee-account",
				field: "收款帳號（銀行代碼＋帳號）與戶名",
				level: "must",
				question: "轉進去的帳號是哪一家銀行、帳號多少？戶名是誰？",
				use: "調閱帳戶交易明細、通報警示帳戶",
				verifyWith: "轉帳紀錄"
			},
			{ id: "transfer-time", field: "轉帳日期與時間（到分鐘）", level: "must", question: "那筆轉帳是幾月幾日、幾點幾分？", use: "調閱交易明細時鎖定區間", verifyWith: "轉帳紀錄" },
			{ id: "payer-account", field: "轉出帳戶（被害人的銀行與帳號）", level: "lead", question: "您是從哪一家銀行、哪個帳戶轉出去的？", use: "向轉出銀行調閱交易序號、確認金流起點" },
			{ id: "transaction-no", field: "交易序號或轉帳截圖", level: "lead", question: "那筆轉帳的交易序號或截圖還在嗎？", use: "據以函調帳戶交易明細" },
			{ id: "transfer-channel", field: "轉帳方式與地點（網銀／臨櫃／ATM）", level: "add", question: "是用網路銀行、臨櫃，還是去 ATM 轉的？在哪裡？", use: "臨櫃可調關懷提問紀錄；ATM 可調機台監視器" }
		]
	},
	{
		id: "cash-handover",
		group: "delivery",
		name: "面交現金",
		appliesWhen: "被害人當面把現金、金飾或物品交給他人（車手）",
		items: [
			{ id: "handover-time", field: "交付時間（到分鐘）", level: "must", question: "交錢是哪一天、幾點幾分？前後大概多久？", use: "調閱監視器的時間區間；監視器保存期限短，應優先" },
			{ id: "handover-place", field: "交付地點（具體地址或店名）", level: "must", question: "在哪裡交錢？可以說出路名、門牌或是哪一家店嗎？", use: "調閱周邊監視器、追查車手來去路線" },
			{ id: "runner-look", field: "車手外貌、衣著、口音與特徵", level: "lead", question: "來拿錢的人性別、年紀、身高、穿著、口音、有沒有戴口罩或明顯特徵？", use: "監視器比對與指認" },
			{ id: "runner-vehicle", field: "交通工具、車牌與離去方向", level: "lead", question: "對方怎麼來、怎麼走的？什麼車、什麼顏色、車牌有沒有看到？往哪個方向離開？", use: "車行軌跡追查、車號查詢" },
			{
				id: "receipt",
				field: "收據或工作證：是否取得、目前在哪、是否碰觸",
				level: "lead",
				question: "對方有沒有給您收據或出示工作證？收據現在在哪裡？交付時您有沒有摸過？",
				use: "收據可能留有指紋或筆跡，可採證；工作證可比對偽造文書"
			},
			{ id: "runner-call", field: "交付時車手是否通話", level: "lead", question: "交錢的時候，對方有沒有一邊講電話或叫您跟誰通話？", use: "調閱基地台通聯，連結車手與機房" },
			{ id: "cash-source", field: "款項來源（提領、解約、借貸）", level: "add", question: "這筆現金是從哪裡來的？哪一天在哪間銀行領的？", use: "確認損害、調閱提領時行員關懷紀錄" }
		]
	},
	{
		id: "crypto",
		group: "delivery",
		name: "虛擬貨幣",
		appliesWhen: "被害人購買虛擬貨幣（USDT 等）後轉給對方，或經由幣商交易",
		items: [
			{ id: "crypto-channel", field: "購幣管道（交易所名稱／幣商／虛擬貨幣 ATM）", level: "must", question: "幣是在哪裡買的？哪一家交易所，還是跟幣商買？", use: "函調交易所 KYC 與交易資料" },
			{ id: "wallet-address", field: "轉入的錢包地址", level: "must", question: "幣轉到哪個錢包地址？可以給我看畫面嗎？", use: "鏈上金流追查", verifyWith: "交易紀錄截圖" },
			{ id: "txid", field: "交易識別碼 TxID、時間、幣別與數量", level: "lead", question: "那筆轉出的 TxID、時間、幣別和數量是多少？", use: "鎖定鏈上交易、追查後續流向", verifyWith: "交易紀錄截圖" },
			{ id: "exchange-account", field: "被害人自己的交易所帳號", level: "lead", question: "您在交易所的帳號是哪一個？是對方教您註冊的嗎？", use: "調閱帳號登入 IP 與操作紀錄" },
			{ id: "otc-handover", field: "幣商面交的時間、地點與對象", level: "lead", question: "如果是跟幣商面交，是在哪裡、什麼時候、對方是誰？", use: "同面交現金：監視器與身分追查" }
		]
	},
	{
		id: "points-codes",
		group: "delivery",
		name: "遊戲點數／超商代碼繳費",
		appliesWhen: "被害人購買遊戲點數或以超商代碼繳費給對方",
		items: [
			{ id: "point-serial", field: "點數種類、序號或繳費代碼", level: "must", question: "買的是哪一種點數？序號或繳費代碼還有嗎？", use: "向發行商調閱儲值與兌換帳號", verifyWith: "購買收據" },
			{ id: "store-time", field: "購買門市與時間", level: "lead", question: "在哪一家超商門市、什麼時間買的？", use: "調閱門市監視器與交易紀錄" }
		]
	},
	{
		id: "mail-cards",
		group: "delivery",
		name: "寄交提款卡／存摺",
		appliesWhen: "被害人寄出或交付提款卡、存摺、密碼",
		items: [
			{ id: "shipment", field: "寄件時間、門市或物流、寄件單號", level: "must", question: "什麼時候、在哪裡寄的？寄件單號還在嗎？", use: "調閱物流紀錄與取件監視器", verifyWith: "寄件單據" },
			{ id: "recipient", field: "收件人與收件門市", level: "must", question: "寄給誰？寄到哪一家門市或地址？", use: "追查取件人身分" },
			{ id: "card-detail", field: "卡片所屬銀行、帳號與是否告知密碼", level: "must", question: "寄出的是哪些銀行的卡？有沒有把密碼告訴對方？", use: "通報警示帳戶、判斷是否另涉幫助詐欺" }
		]
	},
	{
		id: "fake-investment",
		group: "fraud",
		name: "假投資",
		appliesWhen: "以投資、股票、虛擬貨幣獲利為名",
		items: [
			{ id: "platform", field: "投資平台名稱、網址或 APP", level: "lead", question: "投資用的平台叫什麼？網址或 APP 名稱是什麼？", use: "調閱網域資料、比對同一平台的其他案件" },
			{ id: "teacher-roles", field: "老師、助理、客服的名稱與帳號", level: "lead", question: "跟您聯絡的老師、助理或客服各叫什麼名字、用什麼帳號？", use: "辨識集團分工與帳號" },
			{ id: "withdraw-block", field: "無法出金的理由（保證金、稅金等）", level: "add", question: "要領錢的時候，對方用什麼理由叫您再付錢？", use: "確認詐術內容，辨識話術型態" }
		]
	},
	{
		id: "fake-official",
		group: "fraud",
		name: "假冒公務機關（檢警、法院、健保）",
		appliesWhen: "對方自稱檢察官、警察、法院或其他公務機關人員",
		items: [
			{ id: "impersonated", field: "冒用的機關、人員姓名與職稱", level: "lead", question: "對方說自己是哪個單位、叫什麼名字、什麼職稱？", use: "比對冒用身分的系列案件" },
			{ id: "fake-document", field: "是否收到公文、監管命令或押票", level: "lead", question: "對方有沒有傳公文或文件給您？現在還在嗎？", use: "偽造公文書可另案偵辦並採證" },
			{ id: "account-control", field: "是否被要求監管帳戶或交出網銀帳密", level: "must", question: "對方有沒有要求您交出帳戶、網銀帳號密碼或提款卡？", use: "判斷帳戶是否已遭控制，需立即止付" }
		]
	},
	{
		id: "online-shopping",
		group: "fraud",
		name: "網路購物／解除分期付款",
		appliesWhen: "買賣交易或假冒客服要求解除分期、重複扣款",
		items: [
			{ id: "shop", field: "賣場網址、賣家帳號與訂單編號", level: "lead", question: "是在哪個平台、哪個賣場買的？賣家帳號和訂單編號是什麼？", use: "向平台調閱賣家資料" },
			{ id: "fake-cs", field: "假客服或假銀行來電號碼", level: "lead", question: "自稱客服或銀行的人用哪個號碼打給您？", use: "調閱通聯、比對系列案件", verifyWith: "手機通話紀錄畫面" }
		]
	},
	{
		id: "romance",
		group: "fraud",
		name: "假交友（感情詐騙）",
		appliesWhen: "以交友、感情關係為基礎要求金錢",
		items: [
			{ id: "dating-platform", field: "認識的交友平台與對方帳號", level: "lead", question: "在哪個交友平台認識的？對方帳號和自稱的身分是什麼？", use: "向平台調閱帳號資料" },
			{ id: "photos", field: "對方提供的照片或身分資料", level: "add", question: "對方有沒有傳照片或證件給您？", use: "反查照片來源、確認身分是否冒用" }
		]
	}
];

/** Compact text form of the knowledge base for the model's developer instructions. */
export function formatKnowledgeBase(scenarios: readonly KnowledgeScenario[] = KNOWLEDGE_BASE): string {
	return scenarios
		.map(scenario => {
			const items = scenario.items
				.map(item => `  - [${item.id}] ${item.field}｜${item.level}｜問：${item.question}｜用途：${item.use}${item.verifyWith ? `｜核對：${item.verifyWith}` : ""}`)
				.join("\n");
			return `## ${scenario.name}（${scenario.id}）\n適用：${scenario.appliesWhen}\n${items}`;
		})
		.join("\n\n");
}
