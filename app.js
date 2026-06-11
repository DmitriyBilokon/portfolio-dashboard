const ALL={"data": {"OMXS30": {"headers": ["#", "Компания", "Тикер", "Сектор", "Цена 13 фев", "1д %", "Аналит. Таргет", "Потенциал %", "Дивид. %", "SMA 50", "SMA 100", "SMA 200", "Позиция vs SMA", "Вес в индексе", "Уровень покупки", "Рейтинг", "Комментарий", "Col18"], "rows": [[1, "AstraZeneca", "AZN", "Фармацевтика", 1718.0, 0.77, 2050, 20.1, 2.1, 1675.87, 1577.42, 1543.25, "🟡 Смешанно", 12, "1581-1698", "⭐⭐⭐", "Strong Buy 20/2. Q4 EPS beat. Pipeline strong. Guidning +двузначн. рост 2026. ЯДРО", ""], [2, "ABB", "ABB", "Электрификация", 691.8, 1.05, 720, 4.3, 1.8, 676.5, 653.73, 597.73, "🟢 Выше всех", 8.5, "592-650", "⭐⭐", "Electrification + automation + robotics. AI data center power demand", ""], [3, "Investor B", "INVE B", "Инвестиции", 320.15, 0, 340, 6, 2.5, 305.48, 282.57, 259.28, "🟢 Выше всех", 6, "291-301", "⭐⭐⭐", "Investment company. Owns Atlas Copco, SEB, ABB stakes. NAV discount ~5%", ""], [4, "Atlas Copco A", "ATCO A", "Промышленность", 169.0, -0.15, 180, 7, 1.5, 166.16, 152.28, 144.86, "🟢 Выше всех", 5.5, "153-160", "⭐⭐⭐", "Компрессоры + вакуум. Stable compounder. Premium valuation P/E ~35", ""], [5, "Volvo B", "VOLV B", "Грузовики", 294.4, 2.11, 290, -1.6, 5.5, 280.2, 274.59, 238.1, "🟢 Выше всех", 5, "260-276", "⭐⭐", "Div 5.5%! Trucks demand. +2.11% сегодня. Таргет достигнут → HOLD", ""], [6, "Nordea Bank", "NDA SE", "Банки", 169.15, 0.3, 160, -5.6, 7.5, 162.97, 157.47, 145.54, "🟢 Выше всех", 4.5, "143-160", "⭐⭐", "Div 7.5%! НО таргет 160 < цена 170 → ПЕРЕОЦЕНЕНА. Sell/Hold", ""], [7, "Sandvik", "SAND", "Горнодобыча", 293.3, -0.27, 300, 3.2, 2.2, 284.92, 266.11, 253.37, "🟢 Выше всех", 4.2, "255-272", "⭐⭐", "Mining tools + cutting tech. Stable. Slight upside", ""], [8, "SAAB B", "SAAB B", "Оборона", 498.15, 2.09, 720, 47.5, 0.8, 468.53, 460.42, 402.33, "🟢 Выше всех", 4, "306-446", "⭐⭐⭐⭐⭐", "⭐ #1 GROWTH! +196% за год! EUR defense. Таргет 720 = +47%. MUST BUY", ""], [9, "Hexagon B", "HEXA B", "Цифр. двойник", 109.7, -0.89, 120, 8.1, 1.2, 106.45, 101.62, 90.12, "🟢 Выше всех", 3.8, "100-105", "⭐⭐⭐", "Digital twin + measurement. Recovery from 2024 bottom. Modest upside", ""], [10, "Ericsson B", "ERIC B", "Телеком оборуд.", 90.34, -0.22, 85, -5.9, 3.5, 88.89, 79.57, 78.79, "🟢 Выше всех", 3.5, "73-85", "⭐", "Telecom equipment. Таргет 85 < цена 90 → ПЕРЕОЦЕНЕНА. 5G cycle mature", ""], [11, "Evolution", "EVO", "Онлайн-казино", 631.0, 1.58, 1100, 74.2, 2, 621.6, 634.74, 564.47, "🟠 Частично", 3.5, "714-563", "⭐⭐⭐", "⭐ #1 VALUE! Таргет 1100 = +74%! P/E ~15. Regulatory fear overdone", ""], [12, "ASSA ABLOY B", "ASSA B", "Замки/безоп.", 358.1, 0.72, 370, 2.2, 1.8, 345.3, 327.65, 292.86, "🟢 Выше всех", 3.3, "316-340", "⭐⭐", "Access solutions. Global #1 locks. Stable compounder. Low upside", ""], [13, "SEB A", "SEB A", "Банки", 189.3, 0.61, 190, 0.2, 6, 186.47, 174.41, 161.14, "🟢 Выше всех", 3.2, "163-179", "⭐⭐⭐⭐", "Div 6%! НО таргет = цена → FAIR VALUE. Hold for dividend", ""], [14, "Essity B", "ESSITY B", "Потреб. товары", 258.0, 0.38, 315, 20.6, 3.2, 265.08, 261.2, 250.94, "🟡 Смешанно", 3, "245-262", "⭐⭐⭐⭐", "⭐ Защитная. Industrivärden купил 262M kr. Div 3.2%. Upside +20%", ""], [15, "Swedbank A", "SWED A", "Банки", 305.4, 0.79, 280, -8.2, 7, 342, 328, 298, "🟢 Выше всех", 3, "265-281", "⭐⭐", "Div 7%! НО таргет 280 < цена 305 → ПЕРЕОЦЕНЕНА. Sell / trim", ""], [16, "Svenska Handelsbanken A", "SHB A", "Банки", 131.2, 0.76, 121, -8.4, 6.5, 126.07, 120.8, 118.34, "🟢 Выше всех", 2.8, "120-126", "⭐⭐", "Div 6.5%! НО таргет 121 < цена 132 → ПЕРЕОЦЕНЕНА. Sell / trim", ""], [17, "H&M B", "HM B", "Ритейл/мода", 173.95, -0.2, 185, 4.2, 4, 173.64, 160.88, 156.13, "🟢 Выше всех", 2.5, "158-170", "⭐⭐⭐", "Fast fashion. Q4 mixed. Turnaround story. Modest upside +4%", ""], [18, "Skanska B", "SKA B", "Строительство", 263.0, 0.61, 260, 5, 3.5, 238.96, 226.38, 206.55, "🟢 Выше всех", 2.4, "224-238", "⭐⭐⭐", "Строительство + девелопмент. Housing recovery play. Modest upside", ""], [19, "EQT AB", "EQT", "PE Fund", 335.3, 1.08, 330, 0.8, 0.5, 318.67, 310.52, 277.98, "🟢 Выше всех", 2.3, "286-306", "⭐⭐", "Private equity. AUM growing. ~Fair value. Low div", ""], [20, "Lifco B", "LIFCO B", "Конгломерат", 352, -0.11, 380, 8, 0.8, 336.55, 309.84, 306.35, "🟢 Выше всех", 2.2, "306-330", "⭐⭐⭐", "⭐ Serial acquirer. ROIC >20%. Stable compounder. Upside +8%", ""], [21, "Addtech", "ADDT B", "Промтех дистр.", 331.8, -0.36, 350, 5.5, 1, 317.05, 308.79, 267.24, "🟢 Выше всех", 2, "286-315", "⭐⭐⭐", "Tech distribution. Niche acquirer. Similar model to Lifco", ""], [22, "Alfa Laval", "ALFA", "Теплообменники", 460.8, -0.09, 480, 2.8, 2, 446.74, 440.93, 397.79, "🟢 Выше всех", 2, "408-441", "⭐⭐", "Heat exchangers. Marine + energy. Slight upside", ""], [23, "Boliden", "BOL", "Горнодобыча", 458.5, 0.15, 500, 6.7, 4, 446.75, 433.99, 398.91, "🟢 Выше всех", 1.8, "408-441", "⭐⭐⭐⭐", "Copper + zinc miner. Commodity cycle. Div 4%. Upside +7%", ""], [24, "Epiroc A", "EPI A", "Горнодобыча", 186.7, 1.07, 220, 5.4, 1.5, 204.03, 186.68, 183.9, "🟢 Выше всех", 1.7, "189-199", "⭐⭐⭐", "Mining equipment. Recovery. Modest upside +5%", ""], [25, "SKF B", "SKF B", "Подшипники", 248.3, 0.52, 260, 3.6, 3, 240.17, 230.79, 225.24, "🟢 Выше всех", 1.5, "230-238", "⭐⭐⭐", "Bearings global #1. Cyclical recovery. Div 3%", ""], [26, "SCA B", "SCA B", "Лесопром.", 122.7, -0.81, 130, 5.9, 2.5, 124.47, 115.75, 116.48, "🟡 Смешанно", 1.5, "117-121", "⭐⭐", "Forest + paper. Timberland assets. Slight upside", ""], [27, "NIBE Industrier B", "NIBE B", "Теплонасосы", 36.7, 3.35, 42, 14.4, 0.5, 36.16, 36.88, 32.97, "🟠 Частично", 1.3, "39-34", "⭐", "⭐ +3.35% сегодня! Heat pumps contrarian. Упала с 120 до 36. Таргет 42 = +14%", ""], [28, "Industrivärden C", "INDU C", "Инвестиции", 397.5, 0.51, 400, 0.6, 3, 384.65, 366.61, 353.62, "🟢 Выше всех", 1.2, "362-378", "⭐⭐⭐", "Inv. company. Owns Volvo, SHB, Sandvik, Essity. NAV discount", ""], [29, "Telia Company", "TELIA", "Телеком", 37.96, -0.08, 40, 4.3, 5, 36.62, 34.74, 34.35, "🟢 Выше всех", 1, "36-37", "⭐⭐⭐⭐", "Nordic telecom. Div 5%. Stable. Low growth. Slight upside", ""], [30, "Tele2 AB", "TEL2 B", "Телеком", 146.5, 0.65, 150, 1.5, 4.5, 145.6, 131.75, 128.59, "🟢 Выше всех", 0.8, "133-141", "⭐⭐⭐", "Nordic telecom #2. Div 4.5%. Stable. Near fair value", ""]], "subtitle": "OMXS30 = 3,156.67 (+0.64%) | ATH зона | Strong Buy | Все SMA бычьи | YTD +8.8%", "count": 30}, "Nasdaq 100": {"headers": ["#", "Компания", "Тикер", "Сектор", "Цена", "1д %", "Таргет", "Потенц. %", "Див. %", "Вес %", "SMA", "Покупка", "Рейтинг", "Комментарий", "SMA 50", "SMA 100", "SMA 200"], "rows": [[1, "Apple", "AAPL", "Tech / Consumer", 261.73, -1.21, 300, 6.9, 0.5, 8.5, "🟢", "258-272", "⭐⭐⭐", "iPhone + Services + Vision Pro. P/E~32. Stable cashflow king", 275.32, 258.61, 233.8], [2, "NVIDIA", "NVDA", "AI / Semiconductors", 183.38, 2.11, 220, 20, 0, 7.8, "🔴", "169-178", "⭐⭐", "⭐ AI chip monopoly. H200/B200. НИЖЕ SMA200 = BUY opportunity!", 188.33, 198.42, 219.82], [3, "Microsoft", "MSFT", "Cloud / Software", 401.84, 0.65, 520, 8.1, 0.7, 7.5, "🟡", "442-466", "⭐⭐", "Azure + Copilot AI. Recovering. Stable compounder", 475.11, 458.7, 466.65], [4, "Alphabet A", "GOOGL", "Search / Cloud", 309.0, -0.63, 350, 10.2, 0, 5.2, "🟡", "292-308", "⭐⭐", "Search + GCP + Gemini. Strong ad revenue", 318.67, 323.25, 296.84], [5, "Amazon", "AMZN", "E-commerce / Cloud", 199.6, -1.41, 260, 13.5, 0, 4.8, "🟡", "211-222", "⭐⭐", "AWS #1 cloud. E-comm + ads. Slight weakness", 227.65, 211.81, 197.08], [6, "Meta Platforms", "META", "Social / AI", 661.53, 3.43, 700, 5.8, 0.3, 4, "🟢", "609-642", "⭐⭐⭐", "⭐ Ads + Llama AI + Threads. +3.43% rally! Strong momentum", 641.27, 612.45, 543.39], [7, "Broadcom", "AVGO", "AI Networking", 210, -2.5, 240, 14.3, 1.2, 3.5, "🟡", "193-204", "⭐⭐", "Custom AI ASIC + VMware. Volatile but strong fundamentals", 204.22, 209.06, 184.43], [8, "Tesla", "TSLA", "EV / Autonomous", 417.07, 1.74, 350, -23, 0, 3.2, "🟢", "418-441", "⭐", "Robotaxi + FSD + Energy. ПЕРЕОЦЕНЕНА! Таргет 350 < цена 454", 437.8, 402.28, 388.87], [9, "Costco", "COST", "Retail", 950, 0.3, 980, 3.2, 0.5, 2.8, "🟢", "874-922", "⭐⭐", "Defensive retail. Premium P/E 50+. Membership moat", 935.35, 859.59, 809.43], [10, "Netflix", "NFLX", "Streaming", 75.86, -0.71, 115, 11.4, 0, 1.8, "🟢", "95-100", "⭐⭐⭐", "Streaming #1. Ad tier + live sports driving growth", 98.3, 96.21, 91.35], [11, "AMD", "AMD", "Semiconductors", 210.64, -1.34, 180, -14.5, 0, 1.7, "🔴", "194-204", "⭐", "MI300X AI chip. ПЕРЕОЦЕНЕНА! Таргет 180 < 210", 213.11, 228.24, 231.67], [12, "T-Mobile US", "TMUS", "Telecom", 275, 0.5, 290, 5.5, 1.2, 1.6, "🟢", "253-267", "⭐⭐⭐", "Wireless #1 US. Div growing. 5G leader", 266.82, 243.16, 236.41], [13, "Cisco Systems", "CSCO", "Networking", 58, -9.69, 65, 12.1, 3, 1.5, "🔴", "53-56", "⭐⭐", "⚠️ CRASH -9.69%! Слабый прогноз. Div 3% удерживает", 61.66, 62.42, 64.39], [14, "Adobe", "ADBE", "Software", 485, -0.5, 520, 7.2, 0, 1.4, "🟡", "446-470", "⭐⭐", "Creative Cloud + Firefly AI. Enterprise adoption", 488.48, 491.66, 449.0], [15, "Intuit", "INTU", "FinTech", 680, 0.3, 720, 5.9, 0.5, 1.3, "🟢", "626-660", "⭐⭐⭐", "TurboTax + QuickBooks + AI automation", 661.58, 617.37, 560.34], [16, "Qualcomm", "QCOM", "Mobile Chips", 185, -0.8, 200, 8.1, 1.8, 1.2, "🟡", "170-179", "⭐⭐", "Snapdragon mobile/auto/IoT. On-device AI", 184.05, 170.79, 171.16], [17, "Applied Materials", "AMAT", "Chip Equipment", 195, -1.2, 210, 7.7, 0.8, 1.1, "🟡", "179-189", "⭐⭐", "Semiconductor equipment #1. AI capex cycle", 198.53, 186.9, 184.0], [18, "Lam Research", "LRCX", "Chip Equipment", 82, -0.5, 90, 9.8, 0.9, 1, "🟡", "75-80", "⭐⭐", "Etch + deposition. Chip manufacturing", 80.5, 79.15, 75.32], [19, "Palo Alto Networks", "PANW", "Cybersecurity", 198, 0.8, 220, 11.1, 0, 1, "🟢", "182-192", "⭐⭐⭐", "⭐ Cyber #1. Platformization. +11% upside", 192.25, 174.5, 171.36], [20, "Texas Instruments", "TXN", "Analog Chips", 200, 0.2, 210, 5, 2.5, 0.9, "🟢", "184-194", "⭐⭐⭐", "Analog chips king. Cyclical bottom. Div 2.5%", 193.68, 185.27, 176.74], [21, "Booking Holdings", "BKNG", "Travel", 4312.44, 0.5, 4500, 4.3, 0.5, 0.9, "🟢", "3967-4183", "⭐⭐", "Online travel monopoly. Record bookings", 4119.62, 3900.33, 3565.22], [22, "Micron Technology", "MU", "Memory / AI", 110, 3, 130, 18.2, 0.4, 0.9, "🟢", "101-107", "⭐⭐⭐⭐", "⭐ HBM4 for AI! +3% surge. Memory super-cycle", 105.87, 102.65, 88.69], [23, "Salesforce", "CRM", "CRM/Cloud", 247.46, 3.66, 280, 13.1, 0.5, 0.8, "🟡", "228-240", "⭐⭐", "CRM #1. Agentforce AI. +3.66% recovery", 249.0, 228.13, 214.19], [24, "PepsiCo", "PEP", "Consumer Staples", 148, -0.3, 160, 8.1, 3.2, 0.8, "🟢", "136-144", "⭐⭐⭐⭐", "Defensive. Div 3.2%. Frito-Lay + Gatorade", 141.97, 134.48, 132.73], [25, "PayPal", "PYPL", "Payments", 85, 1.2, 100, 17.6, 0, 0.7, "🟡", "78-82", "⭐⭐⭐", "Digital payments turnaround. New CEO momentum", 83.48, 79.32, 74.13], [26, "Starbucks", "SBUX", "Restaurant", 105, 0.4, 115, 9.5, 2.3, 0.7, "🟡", "97-102", "⭐⭐⭐", "Coffee #1. New CEO turnaround. Div 2.3%", 106.18, 98.26, 100.69], [27, "MercadoLibre", "MELI", "LatAm E-comm", 2000, 0.8, 2200, 10, 0, 0.7, "🟢", "1840-1940", "⭐⭐⭐", "LatAm Amazon+FinTech. Huge TAM. +10% upside", 1921.15, 1869.33, 1618.2], [28, "Arista Networks", "ANET", "Networking", 105, -1.5, 120, 14.3, 0, 0.7, "🟡", "97-102", "⭐⭐", "Data center switching. AI demand driver", 103.05, 100.77, 90.34], [29, "Mondelez", "MDLZ", "Consumer Staples", 68, -0.4, 75, 10.3, 2.5, 0.6, "🟢", "63-66", "⭐⭐⭐⭐", "Oreo, Cadbury. Global snacks. Defensive", 64.6, 64.22, 59.22], [30, "Intuitive Surgical", "ISRG", "Med Devices", 600, 0.5, 640, 6.7, 0, 0.6, "🟢", "552-582", "⭐⭐⭐", "da Vinci robot surgery. Procedure growth", 573.54, 530.82, 487.82], [31, "Marvell Technology", "MRVL", "Custom AI Silicon", 110, -2, 130, 18.2, 0.3, 0.6, "🔴", "101-107", "⭐⭐", "Custom AI chips. Amazon/Google. Volatile", 113.19, 118.72, 120.83], [32, "KLA Corp", "KLAC", "Chip Inspection", 780, -0.8, 820, 5.1, 0.9, 0.6, "🟡", "718-757", "⭐⭐", "Process control. Chip manufacturing quality", 776.69, 764.33, 744.71], [33, "Intel", "INTC", "Semiconductors", 40.5, -7.45, 35, -13.6, 0, 0.6, "🔴", "37-39", "⭐", "⚠️ CRASH -7.45%! Foundry struggles. ПЕРЕОЦЕНЕНА. AVOID", 43.29, 44.92, 45.22], [34, "Linde", "LIN", "Industrial Gas", 475, 0.3, 500, 5.3, 1.2, 0.6, "🟢", "437-461", "⭐⭐⭐", "Industrial gas #1. Steady compounder", 458.44, 421.26, 388.28], [35, "Vertex", "VRTX", "Biotech", 440, 0.6, 480, 9.1, 0, 0.5, "🟢", "405-427", "⭐⭐⭐", "CASGEVY gene therapy. CF franchise cash cow", 428.83, 395.29, 372.39], [36, "Analog Devices", "ADI", "Analog Chips", 230, 0.2, 250, 8.7, 1.5, 0.5, "🟢", "212-223", "⭐⭐⭐", "Analog/mixed-signal. Cyclical recovery", 220.48, 209.04, 188.79], [37, "Synopsys", "SNPS", "EDA Software", 520, -0.3, 560, 7.7, 0, 0.5, "🟡", "478-504", "⭐⭐", "Chip design software. AI accelerates demand", 518.87, 513.79, 495.54], [38, "Cadence Design", "CDNS", "EDA Software", 300, -0.4, 330, 10, 0, 0.5, "🟡", "276-291", "⭐⭐", "Chip simulation + verification. IP leader", 296.99, 286.37, 292.09], [39, "Palantir", "PLTR", "AI / Analytics", 128, -3, 100, -21.9, 0, 0.5, "🔴", "118-124", "⭐", "⚠️ P/S ~70! BUBBLE valuation. ПЕРЕОЦЕНЕНА. AVOID", 133.44, 142.09, 147.79], [40, "Workday", "WDAY", "HR Software", 280, 0.5, 300, 7.1, 0, 0.4, "🟡", "258-272", "⭐⭐", "HR/Finance SaaS. AI agent adoption", 275.23, 282.57, 266.16], [41, "ASML", "ASML", "Chip Equipment", 750, -1.2, 800, 6.7, 0.8, 0.4, "🟡", "690-728", "⭐⭐", "EUV lithography monopoly. China risk", 739.42, 714.72, 688.28], [42, "CrowdStrike", "CRWD", "Cybersecurity", 380, 1, 420, 10.5, 0, 0.4, "🟢", "350-369", "⭐⭐⭐", "Endpoint security #1. Post-outage recovery", 364.88, 344.58, 328.87], [43, "Monster Beverage", "MNST", "Beverages", 55, 0.2, 60, 9.1, 0, 0.4, "🟢", "51-53", "⭐⭐⭐", "Energy drinks. Growth + 60% margins", 53.27, 51.15, 47.95], [44, "Gilead Sciences", "GILD", "Biotech", 110, 0.5, 120, 9.1, 3.5, 0.4, "🟢", "101-107", "⭐⭐⭐⭐", "⭐ HIV + liver. Div 3.5%. Defensive biotech", 107.1, 100.03, 90.62], [45, "CoStar Group", "CSGP", "Real Estate Tech", 80, 0.3, 90, 12.5, 0, 0.3, "🟡", "74-78", "⭐⭐", "Commercial RE data + Homes.com", 80.05, 75.15, 77.47], [46, "PACCAR", "PCAR", "Trucks", 115, 0.4, 125, 8.7, 3, 0.3, "🟢", "106-112", "⭐⭐⭐⭐", "Kenworth/Peterbilt trucks. Div 3%", 111.66, 106.77, 94.98], [47, "Datadog", "DDOG", "Cloud Monitoring", 145, 0.8, 170, 17.2, 0, 0.3, "🟢", "133-141", "⭐⭐⭐⭐", "⭐ Observability + AI monitoring. +17% upside", 143.08, 135.59, 125.95], [48, "O'Reilly Automotive", "ORLY", "Auto Parts", 1200, 0.2, 1280, 6.7, 0, 0.3, "🟢", "1104-1164", "⭐⭐⭐", "Auto parts. Defensive. Huge buybacks", 1156.88, 1108.38, 1055.03], [49, "DoorDash", "DASH", "Delivery", 190, 1.2, 210, 10.5, 0, 0.3, "🟢", "175-184", "⭐⭐⭐", "Food delivery #2. Finally profitable", 188.02, 170.04, 157.39], [50, "The Trade Desk", "TTD", "Ad Tech", 80, -11.41, 100, 25, 0, 0.3, "🔴", "74-78", "⭐⭐", "⚠️ CRASH -11.41%! Digital ads. Earnings miss", 81.73, 90.78, 97.31], [51, "Snowflake", "SNOW", "Cloud Data", 234.77, -11.41, 280, 19.3, 0, 0.3, "🔴", "216-228", "⭐⭐", "⚠️ CRASH -11.41%! Cloud data warehouse", 246.1, 261.28, 276.27], [52, "Marriott", "MAR", "Hotels", 260, 0.3, 280, 7.7, 0.8, 0.3, "🟢", "239-252", "⭐⭐⭐", "Hotels #1 global. Travel resilient", 254.72, 244.75, 227.03], [53, "Cintas", "CTAS", "Uniforms", 210, 0.1, 220, 4.8, 0.8, 0.3, "🟢", "193-204", "⭐⭐", "Uniforms + facility. Steady compounder", 201.38, 192.64, 184.92], [54, "Ross Stores", "ROST", "Off-Price Retail", 155, -0.5, 165, 6.5, 0.9, 0.3, "🟢", "143-150", "⭐⭐⭐", "Off-price retail. Consumer spending", 148.11, 136.86, 131.54], [55, "Old Dominion", "ODFL", "Logistics", 195, 0.2, 210, 7.7, 0.4, 0.3, "🟢", "179-189", "⭐⭐⭐", "LTL freight. Premium operator", 192.33, 183.67, 165.43], [56, "Fortinet", "FTNT", "Cybersecurity", 105, 0.6, 115, 9.5, 0, 0.3, "🟢", "97-102", "⭐⭐⭐", "Firewall + SASE. Security demand growing", 101.17, 97.37, 90.07], [57, "Zscaler", "ZS", "Cybersecurity", 220, -0.3, 250, 13.6, 0, 0.2, "🟡", "202-213", "⭐⭐", "Zero trust cloud security. High growth", 221.43, 202.84, 202.95], [58, "GE HealthCare", "GEHC", "Med Devices", 90, 0.4, 100, 11.1, 0.2, 0.2, "🟡", "83-87", "⭐⭐", "Medical imaging + AI diagnostics", 88.23, 84.0, 83.27], [59, "Moderna", "MRNA", "Biotech / Vaccines", 35, -1.5, 30, -14.3, 0, 0.2, "🔴", "32-34", "⭐", "mRNA. Revenue declining. ПЕРЕОЦЕНЕНА. AVOID", 36.17, 39.11, 38.0], [60, "Dollar Tree", "DLTR", "Discount Retail", 80, 0.5, 90, 12.5, 0, 0.2, "🟡", "74-78", "⭐⭐", "Discount retail recovery play", 79.84, 74.51, 76.78], [61, "Axon Enterprise", "AXON", "Security / Law", 600, 0.8, 650, 8.3, 0, 0.2, "🟢", "552-582", "⭐⭐⭐", "Taser + body cam + AI. Law enforcement tech", 585.14, 565.15, 521.17], [62, "Verisk Analytics", "VRSK", "Data Analytics", 290, 0.2, 310, 6.9, 0.5, 0.2, "🟢", "267-281", "⭐⭐⭐", "Insurance data analytics monopoly", 278.69, 261.48, 239.58], [63, "Copart", "CPRT", "Auto Auctions", 60, 0.3, 65, 8.3, 0, 0.2, "🟢", "55-58", "⭐⭐⭐", "Salvage vehicle online auctions", 59.21, 56.18, 52.68], [64, "MongoDB", "MDB", "Database", 260, -2, 300, 15.4, 0, 0.2, "🔴", "239-252", "⭐⭐", "NoSQL database. AI workloads. Volatile", 268.54, 279.51, 283.17], [65, "Exelon", "EXC", "Utilities", 42, 0.3, 45, 7.1, 3.5, 0.2, "🟢", "39-41", "⭐⭐⭐⭐", "Utility. Div 3.5%. Defensive", 41.48, 38.56, 35.67], [66, "ADP", "ADP", "Payroll", 300, 0.1, 320, 6.7, 2, 0.2, "🟢", "276-291", "⭐⭐⭐⭐", "Payroll #1. 60 million workers. Stable", 292.94, 283.64, 265.32], [67, "Constellation Energy", "CEG", "Nuclear Power", 310, 1.5, 350, 12.9, 0.5, 0.2, "🟢", "285-301", "⭐⭐⭐", "⭐ Nuclear for AI data centers! +12.9% upside", 300.46, 286.17, 268.24], [68, "AppLovin", "APP", "Mobile Ads / AI", 350, 2, 400, 14.3, 0, 0.2, "🟢", "322-340", "⭐⭐⭐", "Mobile ad AI engine. Explosive growth", 336.64, 312.49, 311.38], [69, "Baker Hughes", "BKR", "Oil Services", 45, 0.2, 50, 11.1, 2, 0.2, "🟢", "41-44", "⭐⭐⭐⭐", "Energy services. LNG + clean tech", 44.21, 39.89, 40.39], [70, "Dollar General", "DG", "Discount Retail", 125.29, 14.01, 130, 3.8, 1.5, 0.2, "🟢", "115-122", "⭐⭐", "+14.01% TODAY! Earnings beat. Recovery rally", 123.58, 115.19, 104.54], [71, "Enphase Energy", "ENPH", "Solar", 30.76, 4.66, 35, 13.8, 0, 0.1, "🟡", "28-30", "⭐⭐", "Micro-inverters. Solar bottom? Contrarian", 30.9, 31.44, 26.43], [72, "GE Vernova", "GEV", "Power / Energy", 629.11, 4.51, 700, 11.3, 0.3, 0.2, "🟢", "579-610", "⭐⭐⭐", "⭐ Power generation + grid. AI data center demand!", 600.99, 556.51, 538.24], [73, "Honeywell", "HON", "Industrials", 218, 0.3, 240, 10.1, 2, 0.3, "🟢", "201-211", "⭐⭐⭐⭐", "Automation + aerospace. Stable diversified", 208.35, 204.4, 180.86], [74, "AstraZeneca ADR", "AZN", "Pharma", 70.5, 0.8, 82, 17.1, 2.1, 0.3, "🟢", "64-68", "⭐⭐⭐⭐⭐", "⭐ Same as OMXS30 #1. Strong Buy. Pipeline strong", 66.81, 64.38, 58.55], [75, "Arm Holdings", "ARM", "Chip Design", 160, -1.2, 180, 12.5, 0, 0.3, "🟡", "147-155", "⭐⭐", "Mobile/AI chip architecture. Licensing model", 162.85, 164.19, 149.88], [76, "Super Micro", "SMCI", "AI Servers", 45, -2, 55, 22.2, 0, 0.1, "🔴", "41-44", "⭐", "AI servers. Accounting concerns. HIGH RISK", 47.76, 49.25, 54.25], [77, "Warner Bros Discovery", "WBD", "Media", 10, -0.5, 12, 20, 0, 0.1, "🟡", "9-10", "⭐⭐⭐", "Streaming + studios. Turnaround needed", 10.02, 9.25, 9.62], [78, "Atlassian", "TEAM", "Dev Tools", 260, -0.8, 290, 11.5, 0, 0.2, "🟡", "239-252", "⭐⭐", "Jira + Confluence. Dev collaboration", 255.56, 253.11, 227.67], [79, "ON Semiconductor", "ON", "Power Semis", 52, -1.5, 60, 15.4, 0, 0.2, "🔴", "48-50", "⭐⭐", "EV/industrial power chips. Cyclical", 53.91, 57.44, 61.99], [80, "Dexcom", "DXCM", "Med Devices", 78, 0.5, 90, 15.4, 0, 0.2, "🟡", "72-76", "⭐⭐⭐", "CGM diabetes monitoring. Recovery from 2024 dip", 78.44, 75.7, 69.44], [81, "Kraft Heinz", "KHC", "Consumer Staples", 32, -0.3, 35, 9.4, 4.5, 0.1, "🟢", "29-31", "⭐⭐⭐⭐", "Food. Div 4.5%. Deep value. Warren Buffett", 31.53, 28.3, 28.13], [82, "Electronic Arts", "EA", "Gaming", 140, 0.2, 155, 10.7, 0.6, 0.2, "🟢", "129-136", "⭐⭐⭐", "FIFA/EA Sports. Stable gaming revenue", 133.5, 125.49, 115.48], [83, "CDW Corp", "CDW", "IT Distribution", 185, 0.1, 200, 8.1, 1, 0.2, "🟢", "170-179", "⭐⭐⭐", "IT hardware distribution. Enterprise spending", 178.26, 172.46, 153.27], [84, "Sirius XM", "SIRI", "Satellite Radio", 25, -0.5, 28, 12, 3, 0.1, "🟡", "23-24", "⭐⭐⭐", "Satellite radio. Div 3%. Warren Buffett cut stake", 24.78, 24.2, 22.04], [85, "Charter Comms", "CHTR", "Cable", 370, 0.4, 400, 8.1, 0, 0.2, "🟡", "340-359", "⭐⭐", "Broadband cable. Fiber upgrade cycle", 367.79, 366.52, 314.97], [86, "Lucid Group", "LCID", "EV", 3.5, -2, 4, 14.3, 0, 0.05, "🔴", "3-3", "⭐", "EV startup. Cash burn. HIGH RISK. Speculative", 3.72, 3.76, 4.15]], "subtitle": "NDX ≈ 24,900 | ⚠️ Daily: SELL | НИЖЕ SMA200! | YTD +0.5% | Weekly: Buy | Коррекция в tech. CPI данные 13 фев — ключевой катализатор", "count": 86}, "OMXSPI": {"headers": ["#", "Компания", "Тикер", "Сегмент", "Сектор", "Тип", "Цена", "1д %", "Таргет", "Потенц. %", "Див. %", "SMA", "Рейтинг", "Уровень покупки", "Комментарий", "SMA 50", "SMA 100", "SMA 200"], "rows": [[1, "AstraZeneca", "AZN", "Large", "Фармацевтика", "🛡️ Защитная", 1707.5, 0.77, 2050, 20.1, 2.1, "🟢", "⭐⭐⭐⭐⭐", "1588-1656", "Strong Buy 20/2. Q4 EPS beat. #1 защитная", 1668.52, 1548.57, 1405.55], [2, "ABB", "ABB", "Large", "Электрификация", "💎 Качественная", 690, 1.05, 720, 4.3, 1.8, "🟢", "⭐⭐⭐⭐", "642-669", "Electrification + automation. AI power", 676.5, 653.73, 597.73], [3, "Investor B", "INVE B", "Large", "Инвестиции", "💎 Качественная", 320.8, 0, 340, 6, 2.5, "🟢", "⭐⭐⭐⭐", "298-311", "Wallenberg group. NAV discount", 305.48, 282.57, 259.28], [4, "Atlas Copco A", "ATCO A", "Large", "Промышленность", "💎 Качественная", 168.2, -0.15, 180, 7, 1.5, "🟢", "⭐⭐⭐⭐", "156-163", "Compressors+vacuum. P/E ~35", 166.16, 152.28, 144.86], [5, "Volvo B", "VOLV B", "Large", "Грузовики", "🔄 Циклическая", 294.6, 2.11, 290, -1.6, 5.5, "🟢", "⭐⭐⭐⭐", "274-286", "Div 5.5%! Trucks. Таргет достигнут", 280.2, 274.59, 238.1], [6, "Nordea Bank", "NDA SE", "Large", "Банки", "💰 Дивидендная", 169.5, 0.3, 160, -5.6, 7.5, "🟢", "⭐⭐⭐", "158-164", "Div 7.5%! НО переоценена (таргет 160)", 162.97, 157.47, 145.54], [7, "Sandvik", "SAND", "Large", "Горнодобыча", "🔄 Циклическая", 290.6, -0.27, 300, 3.2, 2.2, "🟢", "⭐⭐⭐", "270-282", "Mining tools. Slight upside", 284.92, 266.11, 253.37], [8, "SAAB B", "SAAB B", "Large", "Оборона", "🚀 Рост", 498.15, 2.09, 720, 47.5, 0.8, "🟢", "⭐⭐⭐⭐⭐", "454-474", "⭐ #1! EUR defense. +196% за год. +47% upside", 468.53, 460.42, 402.33], [9, "Hexagon B", "HEXA B", "Large", "ЦифрДвойник", "💎 Качественная", 111, -0.89, 120, 8.1, 1.2, "🟢", "⭐⭐⭐", "103-108", "Digital twin. Modest upside", 106.45, 101.62, 90.12], [10, "Ericsson B", "ERIC B", "Large", "Телеком обор.", "🔄 Циклическая", 90.3, -0.22, 85, -5.9, 3.5, "🟢", "⭐⭐", "84-88", "Переоценена. 5G cycle mature", 88.89, 79.57, 78.79], [11, "Evolution", "EVO", "Large", "Онлайн-казино", "📊 Стоимость", 631.6, 1.58, 1100, 74.2, 2, "🟡", "⭐⭐⭐⭐⭐", "587-613", "⭐ Таргет 1100! +74% upside! P/E ~15", 621.6, 634.74, 564.47], [12, "ASSA ABLOY B", "ASSA B", "Large", "Замки/безоп.", "💎 Качественная", 361.9, 0.72, 370, 2.2, 1.8, "🟢", "⭐⭐⭐", "337-351", "Access solutions global #1. Low upside", 345.3, 327.65, 292.86], [13, "SEB A", "SEB A", "Large", "Банки", "💰 Дивидендная", 189.65, 0.61, 190, 0.2, 6, "🟢", "⭐⭐⭐", "176-184", "Div 6%. Fair value", 186.47, 174.41, 161.14], [14, "Essity B", "ESSITY B", "Large", "Потреб товары", "🛡️ Защитная", 261.3, 0.38, 315, 20.6, 3.2, "🟢", "⭐⭐⭐⭐⭐", "243-253", "Industrivärden купил 262M. +20% upside", 248.66, 231.1, 230.63], [15, "Swedbank A", "SWED A", "Large", "Банки", "💰 Дивидендная", 305.4, 0.79, 280, -8.2, 7, "🟢", "⭐⭐", "284-296", "Div 7%! НО переоценена", 342, 328, 298], [16, "Handelsbanken A", "SHB A", "Large", "Банки", "💰 Дивидендная", 132.1, 0.76, 121, -8.4, 6.5, "🟢", "⭐⭐", "123-128", "Div 6.5%! НО переоценена", 129.03, 121.08, 116.16], [17, "H&M B", "HM B", "Large", "Ритейл мода", "🔄 Циклическая", 173.95, -0.2, 185, 4.2, 4, "🟡", "⭐⭐⭐", "165-172", "Fast fashion turnaround", 174.65, 176.55, 154.26], [18, "Skanska B", "SKA B", "Large", "Строительство", "🔄 Циклическая", 263.0, 0.61, 260, 5, 3.5, "🟢", "⭐⭐⭐", "230-240", "Housing recovery play", 238.96, 226.38, 206.55], [19, "EQT AB", "EQT", "Large", "PE Fund", "💎 Качественная", 335.3, 1.08, 330, 0.8, 0.5, "🟢", "⭐⭐⭐", "305-318", "Private equity AUM growth", 318.67, 310.52, 277.98], [20, "Lifco B", "LIFCO B", "Large", "Конгломерат", "💎 Качественная", 348.8, -0.11, 380, 8, 0.8, "🟢", "⭐⭐⭐⭐", "327-341", "Serial acquirer. ROIC >20%", 336.55, 309.84, 306.35], [21, "Addtech", "ADDT B", "Large", "Промтех дистр", "💎 Качественная", 331.8, -0.36, 350, 5.5, 1, "🟢", "⭐⭐⭐⭐", "309-322", "Niche acquirer. Similar to Lifco", 317.05, 308.79, 267.24], [22, "Alfa Laval", "ALFA", "Large", "Теплообменники", "🔄 Циклическая", 467, -0.09, 480, 2.8, 2, "🟢", "⭐⭐⭐", "434-453", "Marine + energy", 446.74, 440.93, 397.79], [23, "Boliden", "BOL", "Large", "Горнодобыча", "🔄 Циклическая", 458.5, 0.15, 500, 6.7, 4, "🟢", "⭐⭐⭐", "436-455", "Copper + zinc. Div 4%", 446.75, 433.99, 398.91], [24, "Epiroc A", "EPI A", "Large", "Горнодобыча", "🔄 Циклическая", 186.7, 1.07, 220, 5.4, 1.5, "🟢", "⭐⭐⭐", "194-202", "Mining equipment recovery", 204.03, 186.68, 183.9], [25, "NIBE B", "NIBE B", "Large", "Теплонасосы", "🚀 Рост", 36.7, 3.35, 42, 14.4, 0.5, "🟡", "⭐⭐⭐⭐", "34-36", "⭐ +3.35%! Contrarian. С 120→36. +14%", 36.05, 37.76, 34.65], [26, "Industrivärden C", "INDU C", "Large", "Инвестиции", "💰 Дивидендная", 397.5, 0.51, 400, 0.6, 3, "🟢", "⭐⭐⭐", "370-386", "Owns Volvo,SHB,Sandvik,Essity", 384.65, 366.61, 353.62], [27, "Telia", "TELIA", "Large", "Телеком", "💰 Дивидендная", 38.35, -0.08, 40, 4.3, 5, "🟢", "⭐⭐⭐", "36-37", "Div 5%. Nordic telecom", 37.47, 35.86, 33.13], [28, "Thule Group", "THULE", "Mid", "Потреб товары", "💎 Качественная", 231.2, -2.85, 280, 21.1, 2, "🟡", "⭐⭐⭐⭐⭐", "215-224", "Q4 gross margin 46%! #1 quality mid", 234.59, 213.23, 209.29], [29, "BioGaia B", "BIOG B", "Mid", "Пробиотики", "💎 Качественная", 98.75, -6.13, 120, 21.5, 2.5, "🔴", "⭐⭐⭐⭐⭐", "92-96", "Q4 organic +32%! Лучший квартал. -6% = BUY!", 102.88, 113.07, 115.64], [30, "Sdiptech B", "SDIP B", "Mid", "Инфраструктура", "🚀 Рост", 187.7, -1.31, 270, 43.8, 0, "🟡", "⭐⭐⭐⭐⭐", "175-182", "⭐ #1 growth mid! Q4 organic +25%. +44% upside!", 191.22, 189.18, 176.98], [31, "Betsson B", "BETS B", "Mid", "Беттинг", "💰 Дивидендная", 90.8, -0.99, 110, 21.1, 6, "🔴", "⭐⭐⭐⭐", "84-88", "Div 6% + P/E ~10. Deep value", 95.26, 98.32, 101.76], [32, "Cloetta", "CLOE B", "Mid", "Кондитерская", "🛡️ Защитная", 49.92, -0.96, 55, 10.2, 4.2, "🟡", "⭐⭐⭐⭐", "46-48", "SEB Köp. Div 4.2%. Тихий compounder", 48.82, 49.69, 44.14], [33, "Diös Fastigheter", "DIOS", "Mid", "Недвижимость", "💰 Дивидендная", 65.5, 0.31, 72, 9.9, 4.2, "🟢", "⭐⭐⭐⭐", "61-64", "Div 4.2%. Handelsbanken Köp (höjd 73)", 62.84, 61.53, 53.41], [34, "Scandi Standard", "SCST", "Mid", "Продукты", "📊 Стоимость", 123.8, 2.31, 135, 9, 3.5, "🟢", "⭐⭐⭐⭐", "115-120", "Nordic chicken. Improving margins", 120.63, 113.98, 104.3], [35, "Coor Service", "COOR", "Mid", "Фасилити менедж", "📊 Стоимость", 59.15, -0.76, 65, 9.9, 5, "🟢", "⭐⭐⭐⭐", "55-57", "Div 5%. Recurring contracts", 57.6, 54.92, 48.97], [36, "MilDef Group", "MILDEF", "Mid", "Оборона IT", "🚀 Рост", 140.3, 5.57, 170, 21.2, 0, "🟢", "⭐⭐⭐⭐⭐", "130-136", "⭐ +5.57%! Rugged IT defense. +21%", 134.08, 130.43, 119.03], [37, "CellaVision", "CEVI", "Mid", "Медтехника", "💎 Качественная", 149.4, -1.06, 170, 13.8, 1, "🟡", "⭐⭐⭐⭐", "139-145", "Digital cell morphology monopoly", 150.45, 145.27, 129.65], [38, "Mycronic", "MYCR", "Mid", "Электроника", "💎 Качественная", 403, -2.9, 440, 9.2, 1, "🟡", "⭐⭐⭐⭐", "375-391", "Mask writer monopoly. +9%", 390.95, 408.19, 369.31], [39, "Xvivo Perfusion", "XVIVO", "Mid", "Медтехника", "🚀 Рост", 356, -2.99, 420, 18, 0, "🟡", "⭐⭐⭐⭐", "331-345", "Organ transplant perfusion. +18%", 358.24, 333.57, 339.9], [40, "Lagercrantz", "LAGR B", "Mid", "Конгломерат", "💎 Качественная", 225, 0.4, 250, 11.1, 1, "🟢", "⭐⭐⭐⭐", "209-218", "Serial acquirer. ROIC high", 220.36, 202.52, 196.4], [41, "Sweco B", "SWEC B", "Mid", "Консалтинг", "💎 Качественная", 198, -0.5, 220, 11.1, 2.5, "🟢", "⭐⭐⭐⭐", "184-192", "Engineering consulting. Infrastructure", 188.51, 184.4, 173.77], [42, "Bravida", "BRAV", "Mid", "Строительство", "🔄 Циклическая", 90.2, 0.33, 100, 10.9, 3, "🟢", "⭐⭐⭐⭐", "84-87", "Installation services. Div 3%", 89.1, 84.91, 77.98], [43, "Trelleborg B", "TREL B", "Mid", "Полимеры", "🔄 Циклическая", 373, 0.27, 390, 4.6, 2, "🟢", "⭐⭐⭐", "347-362", "Engineered polymer solutions", 361.61, 333.38, 311.7], [44, "Hexpol B", "HPOL B", "Mid", "Полимеры", "🔄 Циклическая", 126, -0.47, 135, 7.1, 3, "🟢", "⭐⭐⭐", "117-122", "Polymer compounding. Div 3%", 120.18, 119.32, 104.67], [45, "NCC B", "NCC B", "Mid", "Строительство", "🔄 Циклическая", 170, 0.3, 185, 8.8, 5, "🟢", "⭐⭐⭐⭐", "158-165", "Construction. Div 5%. Housing", 168.06, 161.4, 143.07], [46, "Elekta B", "EKTA B", "Mid", "Медтехника", "💎 Качественная", 56, -1.58, 65, 16.1, 2, "🔴", "⭐⭐⭐", "52-54", "Radiation therapy. Below SMA", 58.34, 61.73, 62.29], [47, "Getinge B", "GETI B", "Mid", "Медтехника", "💎 Качественная", 189, 0.85, 210, 11.1, 2, "🟢", "⭐⭐⭐⭐", "176-183", "Medical systems. Recovery", 179.65, 175.99, 155.87], [48, "Securitas B", "SECU B", "Mid", "Безопасность", "🛡️ Защитная", 145, 0.35, 155, 6.9, 1.5, "🟢", "⭐⭐⭐", "135-141", "Security services global", 140.75, 137.39, 116.15], [49, "Dometic", "DOM", "Mid", "Кемпинг", "🔄 Циклическая", 73, -2.14, 85, 16.4, 2, "🔴", "⭐⭐⭐", "68-71", "Mobile living. Cyclical recovery", 76.76, 77.14, 81.45], [50, "Husqvarna B", "HUSQ B", "Mid", "Сад/лес", "🔄 Циклическая", 83, -0.6, 95, 14.5, 3, "🟡", "⭐⭐⭐", "77-81", "Robotmowers. Div 3%", 80.64, 81.61, 76.69], [51, "Nyfosa", "NYF", "Mid", "Недвижимость", "💰 Дивидендная", 105, 0.48, 120, 14.3, 3.5, "🟢", "⭐⭐⭐⭐", "98-102", "Commercial RE. Div 3.5%", 102.53, 95.71, 90.99], [52, "Castellum", "CAST", "Mid", "Недвижимость", "💰 Дивидендная", 145, 0.69, 160, 10.3, 3, "🟢", "⭐⭐⭐⭐", "135-141", "Nordic commercial RE. Recovery", 140.41, 129.76, 127.49], [53, "Sagax B", "SAGA B", "Mid", "Недвижимость", "💰 Дивидендная", 315, 0.32, 340, 7.9, 1.5, "🟢", "⭐⭐⭐⭐", "293-306", "Industrial/warehouse RE. Strong", 301.01, 281.62, 270.18], [54, "Balder B", "BALD B", "Mid", "Недвижимость", "💰 Дивидендная", 87, 1.4, 100, 14.9, 0.5, "🟢", "⭐⭐⭐", "81-84", "Residential+commercial RE", 85.71, 78.33, 71.85], [55, "Lundbergföretagen B", "LUND B", "Mid", "Инвестиции", "💰 Дивидендная", 501.5, 0.18, 580, 1.8, 2.5, "🟢", "⭐⭐⭐", "530-553", "Investment co. Fredrik Lundberg", 544.4, 540.63, 465.76], [56, "Embracer Group B", "EMBRAC B", "Small", "Гейминг", "⚡ Спекулятивная", 54.82, 19.49, 55, 0.3, 0, "🟢", "⭐⭐⭐⭐", "51-53", "⭐ +19.49%! Turnaround! Q3 restructuring works", 52.72, 49.29, 48.5], [57, "Hansa Biopharma", "HNSA", "Small", "Биотехнологии", "⚡ Спекулятивная", 41.22, 6.35, 55, 33.4, 0, "🟢", "⭐⭐⭐⭐", "38-40", "Imlifidase transplant drug. +33% upside", 39.9, 37.45, 33.13], [58, "Stille", "STIL", "Small", "Хирургия", "💎 Качественная", 352, 21.38, 350, -0.6, 1, "🟢", "⭐⭐⭐", "327-341", "⭐ +21.38%! Surgical instruments. ATH", 339.88, 332.35, 307.16], [59, "Solid Försäkring", "SFAB", "Small", "Страхование", "🛡️ Защитная", 101, 1.1, 110, 8.9, 4, "🟢", "⭐⭐⭐⭐", "94-98", "Niche insurance. Div 4%", 96.39, 94.18, 87.04], [60, "Vestum", "VESTUM", "Small", "Инфраструктура", "⚡ Спекулятивная", 12.5, 16.28, 15, 20, 0, "🟡", "⭐⭐⭐", "12-12", "⭐ +16.28%! Serial acquirer turnaround", 12.32, 11.5, 12.13], [61, "Plejd", "PLEJD", "Small", "Умный дом", "🚀 Рост", 150, 1.35, 180, 20, 0, "🟢", "⭐⭐⭐⭐", "140-146", "Smart lighting. Nordic niche", 145.18, 140.29, 120.89], [62, "Camurus", "CAMUR", "Small", "Фарма", "🚀 Рост", 710, -23.06, 850, 19.7, 0, "🔴", "⭐⭐⭐", "660-689", "⚠️ -23%! Q4 miss. Но +20% upside если восст.", 719.47, 755.36, 818.99], [63, "Arjo B", "ARJO B", "Small", "Медтехника", "🛡️ Защитная", 44, -0.45, 50, 13.6, 3.5, "🟡", "⭐⭐⭐", "41-43", "Patient handling. Div 3.5%", 44.18, 44.31, 38.37], [64, "Bulten", "BULTEN", "Small", "Автокомплект", "🔄 Циклическая", 83, 0.61, 95, 14.5, 3, "🟢", "⭐⭐⭐", "77-81", "Fasteners for auto. Div 3%", 81.02, 78.34, 72.07], [65, "Proact IT", "PACT", "Small", "IT услуги", "🚀 Рост", 155, 0.65, 175, 12.9, 2, "🟢", "⭐⭐⭐⭐", "144-150", "IT infrastructure. Hybrid cloud", 152.9, 146.56, 139.12], [66, "Beijer Ref B", "BEIJ B", "Mid", "Холод/HVAC", "💎 Качественная", 175, 0.29, 200, 14.3, 0.8, "🟢", "⭐⭐⭐⭐", "163-170", "Refrigeration components. Heat pump adj.", 166.43, 158.2, 140.37], [67, "Troax Group", "TROAX", "Small", "Безопасность", "💎 Качественная", 235, -0.85, 260, 10.6, 2.5, "🟢", "⭐⭐⭐⭐", "219-228", "Machine guarding. Niche monopoly", 223.44, 210.22, 191.8], [68, "Bufab", "BUFAB", "Small", "Крепёж", "🔄 Циклическая", 320, 0.31, 350, 9.4, 2, "🟢", "⭐⭐⭐", "298-310", "C-parts distribution. Niche", 310.3, 282.07, 280.39], [69, "Knowit", "KNOW", "Small", "IT консалтинг", "🚀 Рост", 220, -0.45, 260, 18.2, 2.5, "🟢", "⭐⭐⭐⭐", "205-213", "Digital transformation. Nordic", 211.51, 195.76, 178.9], [70, "Munters", "MTRS", "Mid", "Климат", "💎 Качественная", 215, -1.83, 240, 11.6, 0.5, "🟡", "⭐⭐⭐⭐", "200-209", "Moisture+data center cooling. AI trend", 217.76, 207.04, 201.74], [71, "Nederman", "NMAN B", "Small", "Очистка возд", "🛡️ Защитная", 229, 2.24, 250, 9.2, 2, "🟢", "⭐⭐⭐⭐", "213-222", "Air filtration. Industrial clean air", 221.91, 207.22, 188.03], [72, "Vitec Software", "VIT B", "Small", "Software", "🚀 Рост", 740, -0.81, 800, 8.1, 0.8, "🟢", "⭐⭐⭐⭐", "688-718", "Vertical SaaS acquirer. Swedish Constellation", 731.41, 674.45, 637.44], [73, "Fortnox", "FNOX", "Mid", "FinTech", "🚀 Рост", 66, -1.94, 80, 21.2, 0.3, "🟡", "⭐⭐⭐⭐", "61-64", "Swedish small biz accounting. Monopoly", 65.4, 67.91, 62.02], [74, "Paradox Interactive", "PDX", "Small", "Гейминг", "⚡ Спекулятивная", 192, 0, 220, 14.6, 2, "🟡", "⭐⭐⭐", "179-186", "Strategy games. CK3, EU5. Niche", 189.62, 191.24, 175.02], [75, "HMS Networks", "HMS", "Small", "IoT/Индустрия", "🚀 Рост", 460, -1.07, 500, 8.7, 1, "🟢", "⭐⭐⭐⭐", "428-446", "Industrial IoT connectivity", 442.96, 414.25, 370.81], [76, "Surgical Science", "SUS", "Small", "Медсимулятор", "🚀 Рост", 175, -3.31, 210, 20, 0, "🔴", "⭐⭐⭐", "163-170", "Surgical simulation training", 185.42, 197.13, 201.04], [77, "Yubico", "YUBICO", "Small", "Кибербезоп", "🚀 Рост", 260, -16.1, 320, 23.1, 0, "🔴", "⭐⭐⭐", "242-252", "⚠️ -16%! But YubiKey auth niche. Speculative buy", 263.65, 274.68, 284.54], [78, "OX2", "OX2", "Small", "Ветроэнергетика", "⚡ Спекулятивная", 42.5, 1.19, 55, 29.4, 0, "🟡", "⭐⭐⭐", "40-41", "Wind farm development. Green energy", 41.89, 41.85, 37.12]], "subtitle": "OMXSPI ≈ 1,085 (+0.30%) | ATH зона | Strong Buy | YTD +9.2% | Анализ: 78 компаний из 300+", "count": 78}, "S&P 500": {"headers": ["#", "Компания", "Тикер", "Сектор", "Цена", "1д %", "Таргет", "Потенц. %", "Див. %", "Вес %", "SMA", "Уровень покупки", "Рейтинг", "Комментарий", "SMA 50", "SMA 100", "SMA 200"], "rows": [[1, "Apple", "AAPL", "Information Tech", 261.73, -1.21, 300, 6.9, 0.5, 7.2, "🟢", "261-272", "⭐⭐", "iPhone+Services+VisionPro. P/E~32. Cash machine", 275.32, 258.61, 233.8], [2, "NVIDIA", "NVDA", "Information Tech", 183.38, 2.11, 220, 20, 0, 6.8, "🔴", "171-178", "⭐", "⭐ AI GPU monopoly. Below SMA200! BUY on dip", 188.33, 198.42, 219.82], [3, "Microsoft", "MSFT", "Information Tech", 401.84, 0.65, 520, 8.1, 0.7, 6.2, "🟡", "447-466", "⭐", "Azure+Copilot. Stable. EPS growth ~15%", 475.11, 458.7, 466.65], [4, "Alphabet A", "GOOGL", "Comm. Services", 309.0, -0.63, 350, 10.2, 0, 3.7, "🟡", "295-308", "⭐⭐", "Search+GCP+Gemini AI. Strong ad revenue", 318.67, 323.25, 296.84], [5, "Amazon", "AMZN", "Consumer Discr.", 199.6, -1.41, 260, 13.5, 0, 3.6, "🟡", "213-222", "⭐⭐", "AWS #1 cloud. Ads+retail. Slight weakness", 227.65, 211.81, 197.08], [6, "Meta Platforms", "META", "Comm. Services", 661.53, 3.43, 700, 5.8, 0.3, 2.8, "🟢", "615-642", "⭐⭐", "⭐ Ads+Llama AI+Threads. +3.43% momentum!", 641.27, 612.45, 543.39], [7, "Broadcom", "AVGO", "Information Tech", 210, -2.5, 240, 14.3, 1.2, 2, "🟡", "195-204", "⭐⭐", "Custom AI ASIC+VMware. Volatile", 204.22, 209.06, 184.43], [8, "Tesla", "TSLA", "Consumer Discr.", 417.07, 1.74, 350, -23, 0, 1.8, "🟢", "423-441", "⭐", "FSD+Robotaxi. ПЕРЕОЦЕНЕНА! Target < price", 437.8, 402.28, 388.87], [9, "Salesforce", "CRM", "Information Tech", 247.46, 3.66, 280, 13.1, 0.5, 0.6, "🟡", "230-240", "⭐⭐", "CRM #1. Agentforce AI. Recovery +3.66%", 249.0, 228.13, 214.19], [10, "AMD", "AMD", "Information Tech", 210.64, -1.34, 180, -14.5, 0, 0.9, "🔴", "196-204", "⭐", "MI300X. ПЕРЕОЦЕНЕНА. Target 180 < 210", 213.11, 228.24, 231.67], [11, "Adobe", "ADBE", "Information Tech", 485, -0.5, 520, 7.2, 0, 0.6, "🟡", "451-470", "⭐", "Creative Cloud+Firefly AI", 488.48, 491.66, 449.0], [12, "Intuit", "INTU", "Information Tech", 680, 0.3, 720, 5.9, 0.5, 0.5, "🟢", "632-660", "⭐⭐", "TurboTax+QuickBooks+AI", 661.58, 617.37, 560.34], [13, "Oracle", "ORCL", "Information Tech", 155, -3.2, 200, 29, 1, 0.7, "🔴", "144-150", "⭐⭐", "⭐ Cloud DB+AI. -3.2% dip. Target 200 = +29%!", 157.18, 164.06, 188.8], [14, "Cisco", "CSCO", "Information Tech", 58, -9.69, 65, 12.1, 3, 0.6, "🔴", "54-56", "⭐⭐", "⚠️ CRASH -9.69%! Weak forecast. Div 3%", 58.59, 62.88, 63.43], [15, "Accenture", "ACN", "Information Tech", 365, 0.4, 400, 9.6, 1.5, 0.6, "🟢", "339-354", "⭐⭐", "IT consulting #1. AI services adoption", 351.51, 333.18, 321.16], [16, "IBM", "IBM", "Information Tech", 280, 0.5, 300, 7.1, 3, 0.5, "🟢", "260-272", "⭐⭐⭐", "AI/Watsonx+Red Hat. Div 3%. Steady", 272.87, 264.66, 225.88], [17, "ServiceNow", "NOW", "Information Tech", 950, -0.8, 1050, 10.5, 0, 0.5, "🟡", "884-922", "⭐⭐", "IT workflow. AI agents. +11% upside", 924.08, 907.43, 813.79], [18, "Palantir", "PLTR", "Information Tech", 128, -3, 100, -21.9, 0, 0.3, "🔴", "119-124", "⭐", "⚠️ P/S ~70! BUBBLE. ПЕРЕОЦЕНЕНА. AVOID", 133.44, 142.09, 147.79], [19, "Texas Instruments", "TXN", "Information Tech", 200, 0.2, 210, 5, 2.5, 0.5, "🟢", "186-194", "⭐⭐", "Analog #1. Cyclical bottom. Div 2.5%", 193.68, 185.27, 176.74], [20, "Qualcomm", "QCOM", "Information Tech", 185, -0.8, 200, 8.1, 1.8, 0.5, "🟡", "172-179", "⭐", "Mobile/auto/IoT chips. AI on-device", 184.05, 170.79, 171.16], [21, "Applied Materials", "AMAT", "Information Tech", 195, -1.2, 210, 7.7, 0.8, 0.5, "🟡", "181-189", "⭐", "Chip equipment #1. AI capex cycle", 198.53, 186.9, 184.0], [22, "Lam Research", "LRCX", "Information Tech", 82, -0.5, 90, 9.8, 0.9, 0.4, "🟡", "76-80", "⭐", "Chip etch+deposition", 80.5, 79.15, 75.32], [23, "Micron", "MU", "Information Tech", 110, 3, 130, 18.2, 0.4, 0.4, "🟢", "102-107", "⭐⭐⭐", "⭐ HBM4 for AI! +3% surge. Memory supercycle", 105.96, 102.9, 98.32], [24, "KLA Corp", "KLAC", "Information Tech", 780, -0.8, 820, 5.1, 0.9, 0.3, "🟡", "725-757", "⭐", "Process control. Chip inspection", 776.69, 764.33, 744.71], [25, "Analog Devices", "ADI", "Information Tech", 230, 0.2, 250, 8.7, 1.5, 0.3, "🟢", "214-223", "⭐⭐", "Mixed-signal. Cyclical recovery", 220.48, 209.04, 188.79], [26, "Marvell", "MRVL", "Information Tech", 110, -2, 130, 18.2, 0.3, 0.3, "🔴", "102-107", "⭐", "Custom AI silicon. Volatile", 116.92, 123.69, 130.74], [27, "Intel", "INTC", "Information Tech", 40.5, -7.45, 35, -13.6, 0, 0.3, "🔴", "38-39", "⭐", "⚠️ CRASH -7.45%! Foundry crisis. AVOID", 43.29, 44.92, 45.22], [28, "Amphenol", "APH", "Information Tech", 147.46, 2.42, 160, 8.5, 0.7, 0.3, "🟢", "137-143", "⭐⭐", "⭐ AI connectors. +2.42%. All SMA bullish", 144.23, 137.95, 121.87], [29, "ON Semiconductor", "ON", "Information Tech", 52, -1.5, 60, 15.4, 0, 0.2, "🔴", "48-50", "⭐", "Power semis. EV/industrial. Cyclical", 53.91, 57.44, 61.99], [30, "UnitedHealth", "UNH", "Health Care", 510, 0.3, 560, 9.8, 1.5, 1.3, "🟢", "474-495", "⭐⭐", "Health insurance #1. Div steady", 497.99, 459.21, 415.44], [31, "Eli Lilly", "LLY", "Health Care", 820, -0.6, 900, 9.8, 0.7, 1.2, "🟡", "763-795", "⭐", "⭐ GLP-1 Mounjaro+Zepbound. Top pharma", 814.44, 794.51, 777.26], [32, "Johnson & Johnson", "JNJ", "Health Care", 155, 0.2, 170, 9.7, 3.2, 0.8, "🟢", "144-150", "⭐⭐⭐", "MedDevices+Pharma. Div 3.2%. Defensive", 152.77, 146.81, 124.94], [33, "AbbVie", "ABBV", "Health Care", 195.0, 0.5, 220, 12.8, 3.5, 0.7, "🟢", "181-189", "⭐⭐⭐⭐", "⭐ Humira→Skyrizi/Rinvoq. Div 3.5%. +13%", 187.24, 173.3, 166.15], [34, "Merck", "MRK", "Health Care", 98, -0.3, 120, 22.4, 3, 0.6, "🟡", "91-95", "⭐⭐⭐⭐", "Keytruda immunotherapy. Div 3%. Value", 96.77, 97.17, 88.16], [35, "Thermo Fisher", "TMO", "Health Care", 560, 0.4, 600, 7.1, 0.2, 0.5, "🟢", "521-543", "⭐⭐", "Life science tools #1", 540.87, 496.11, 492.41], [36, "Abbott", "ABT", "Health Care", 125.0, 0.3, 140, 12, 1.8, 0.5, "🟢", "116-121", "⭐⭐⭐", "FreeStyle Libre+diagnostics", 120.51, 110.37, 112.5], [37, "Pfizer", "PFE", "Health Care", 26, -0.5, 30, 15.4, 6, 0.4, "🟡", "24-25", "⭐⭐⭐", "⭐ Div 6%! Deep value. Post-COVID recovery", 25.94, 24.6, 24.65], [38, "Amgen", "AMGN", "Health Care", 290, 0.3, 310, 6.9, 3.2, 0.4, "🟢", "270-281", "⭐⭐⭐", "Obesity pipeline. Div 3.2%", 279.4, 262.73, 239.06], [39, "Gilead", "GILD", "Health Care", 110, 0.5, 120, 9.1, 3.5, 0.3, "🟢", "102-107", "⭐⭐⭐", "HIV+liver. Div 3.5%. Defensive", 105.74, 96.9, 88.94], [40, "Intuitive Surgical", "ISRG", "Health Care", 600, 0.5, 640, 6.7, 0, 0.3, "🟢", "558-582", "⭐⭐", "da Vinci robot surgery #1", 573.54, 530.82, 487.82], [41, "Vertex", "VRTX", "Health Care", 440, 0.6, 480, 9.1, 0, 0.3, "🟢", "409-427", "⭐⭐", "CASGEVY gene therapy. CF drugs", 428.83, 395.29, 372.39], [42, "Medtronic", "MDT", "Health Care", 88, 0.2, 100, 13.6, 3.2, 0.3, "🟡", "82-85", "⭐⭐⭐", "MedDevices. Div 3.2%. Turnaround", 85.72, 82.13, 86.03], [43, "Danaher", "DHR", "Health Care", 230, 0.1, 260, 13, 0.4, 0.4, "🟢", "214-223", "⭐⭐⭐", "Life science. Danaher Business System", 226.24, 204.3, 196.22], [44, "Stryker", "SYK", "Health Care", 405, 0.3, 440, 8.6, 0.9, 0.3, "🟢", "377-393", "⭐⭐", "Ortho+surgical. Premium growth", 394.2, 360.84, 347.93], [45, "Boston Scientific", "BSX", "Health Care", 100, 0.4, 110, 10, 0, 0.3, "🟢", "93-97", "⭐⭐", "CardioVascular devices. Strong growth", 98.51, 91.44, 80.84], [46, "Regeneron", "REGN", "Health Care", 680, -0.3, 750, 10.3, 0, 0.3, "🟡", "632-660", "⭐⭐", "Dupixent+Eylea. Pipeline strong", 688.51, 649.84, 632.92], [47, "Moderna", "MRNA", "Health Care", 35, -1.5, 30, -14.3, 0, 0.1, "🔴", "33-34", "⭐", "mRNA. Revenue declining. AVOID", 36.17, 39.11, 38.0], [48, "Berkshire Hathaway B", "BRK.B", "Financials", 480, 0.5, 500, 4.2, 0, 1.6, "🟢", "446-466", "⭐⭐", "Buffett. Huge cash pile $325B", 469.21, 444.3, 387.93], [49, "JPMorgan Chase", "JPM", "Financials", 270, 0.4, 290, 7.4, 2, 1.3, "🟢", "251-262", "⭐⭐", "Bank #1. Div 2%. Jamie Dimon", 257.59, 245.72, 236.56], [50, "Visa", "V", "Financials", 340, 0.3, 370, 8.8, 0.7, 1, "🟢", "316-330", "⭐⭐", "Payments #1. Digital growth", 334.03, 315.01, 284.31], [51, "Mastercard", "MA", "Financials", 545, 0.2, 580, 6.4, 0.5, 0.8, "🟢", "507-529", "⭐⭐", "Payments #2. Cross-border growth", 520.98, 485.36, 485.14], [52, "Bank of America", "BAC", "Financials", 46, 0.5, 50, 8.7, 2.2, 0.6, "🟢", "43-45", "⭐⭐", "Consumer banking. Div 2.2%", 43.89, 40.79, 39.71], [53, "Goldman Sachs", "GS", "Financials", 620, 0.3, 660, 6.5, 2, 0.4, "🟢", "577-601", "⭐⭐", "Investment bank #1. IPO recovery", 589.68, 559.11, 523.33], [54, "Morgan Stanley", "MS", "Financials", 130, 0.4, 140, 7.7, 3, 0.3, "🟢", "121-126", "⭐⭐⭐", "Wealth mgmt pivot. Div 3%", 124.9, 121.54, 115.25], [55, "Wells Fargo", "WFC", "Financials", 78, 0.3, 85, 9, 2.5, 0.4, "🟢", "73-76", "⭐⭐", "Consumer bank. Asset cap removal?", 77.0, 73.28, 62.78], [56, "S&P Global", "SPGI", "Financials", 510, 0.2, 550, 7.8, 0.7, 0.3, "🟢", "474-495", "⭐⭐", "Ratings+data monopoly", 490.04, 465.9, 419.58], [57, "BlackRock", "BLK", "Financials", 950, 0.3, 1000, 5.3, 2, 0.3, "🟢", "884-922", "⭐⭐", "AUM $11T+. ETF king. Div 2%", 903.22, 865.09, 847.16], [58, "Charles Schwab", "SCHW", "Financials", 82, 0.4, 90, 9.8, 1.2, 0.3, "🟢", "76-80", "⭐⭐", "Brokerage. TD integration complete", 80.86, 77.67, 71.05], [59, "Progressive", "PGR", "Financials", 260, 0.6, 280, 7.7, 0.2, 0.3, "🟢", "242-252", "⭐⭐", "Auto insurance. Best-in-class", 251.7, 230.39, 232.48], [60, "Marsh McLennan", "MMC", "Financials", 220, 0.2, 240, 9.1, 1.2, 0.2, "🟢", "205-213", "⭐⭐", "Insurance broker #1", 215.68, 202.75, 195.81], [61, "CME Group", "CME", "Financials", 235, 0.1, 250, 6.4, 3.8, 0.2, "🟢", "219-228", "⭐⭐⭐", "Derivatives exchange. Div 3.8%", 230.23, 217.88, 208.55], [62, "Chubb", "CB", "Financials", 280, 0.3, 300, 7.1, 1.3, 0.2, "🟢", "260-272", "⭐⭐", "P&C insurance. Buffett holding", 267.4, 252.31, 243.02], [63, "American Express", "AXP", "Financials", 305, 0.4, 330, 8.2, 1, 0.3, "🟢", "284-296", "⭐⭐", "Premium cards. Millennial adoption", 292.95, 289.69, 254.43], [64, "General Electric", "GE", "Industrials", 210, 0.8, 240, 14.3, 0.6, 0.4, "🟢", "195-204", "⭐⭐⭐", "Aerospace engines. AI maintenance", 201.9, 199.05, 169.59], [65, "Caterpillar", "CAT", "Industrials", 380, 0.2, 400, 5.3, 1.5, 0.4, "🟢", "353-369", "⭐⭐", "Construction+mining. Infrastructure", 369.94, 359.08, 329.26], [66, "RTX Corp", "RTX", "Industrials", 135, 0.5, 150, 11.1, 2, 0.4, "🟢", "126-131", "⭐⭐⭐", "⭐ Defense+aerospace. Patriot missiles", 132.44, 121.42, 116.19], [67, "Honeywell", "HON", "Industrials", 218, 0.3, 240, 10.1, 2, 0.3, "🟢", "203-211", "⭐⭐⭐", "Automation+aerospace. Diversified", 208.35, 204.4, 180.86], [68, "Lockheed Martin", "LMT", "Industrials", 480, 0.4, 520, 8.3, 2.5, 0.3, "🟢", "446-466", "⭐⭐", "⭐ Defense #1 US. F-35. Div 2.5%", 464.38, 447.01, 429.71], [69, "Deere & Co", "DE", "Industrials", 480, -0.3, 500, 4.2, 1.3, 0.3, "🟡", "446-466", "⭐", "Agriculture+autonomy. Cyclical", 479.09, 447.77, 458.92], [70, "Union Pacific", "UNP", "Industrials", 245, 0.2, 260, 6.1, 2, 0.3, "🟢", "228-238", "⭐⭐", "Railroad. Div 2%. Infrastructure", 241.31, 231.45, 219.05], [71, "PACCAR", "PCAR", "Industrials", 115, 0.4, 125, 8.7, 3, 0.2, "🟢", "107-112", "⭐⭐⭐", "Trucks. Div 3%", 111.66, 106.77, 94.98], [72, "Parker-Hannifin", "PH", "Industrials", 680, 0.3, 720, 5.9, 1, 0.2, "🟢", "632-660", "⭐⭐", "Motion & control. Aerospace", 672.28, 610.64, 562.18], [73, "Northrop Grumman", "NOC", "Industrials", 510, 0.5, 560, 9.8, 1.5, 0.2, "🟢", "474-495", "⭐⭐", "Defense. B-21 bomber. Space", 504.04, 477.98, 419.4], [74, "Illinois Tool Works", "ITW", "Industrials", 265, 0.1, 280, 5.7, 2.2, 0.2, "🟢", "246-257", "⭐⭐", "Diversified. 80/20 model. Div 2.2%", 253.97, 238.51, 217.08], [75, "Emerson Electric", "EMR", "Industrials", 120, 0.3, 135, 12.5, 1.8, 0.2, "🟢", "112-116", "⭐⭐⭐", "Automation. AspenTech. Software pivot", 117.91, 108.01, 97.86], [76, "GE Vernova", "GEV", "Industrials", 629.11, 4.51, 700, 11.3, 0.3, 0.2, "🟢", "585-610", "⭐⭐⭐", "⭐ Power+grid. AI data center demand! +4.51%", 600.99, 556.51, 538.24], [77, "L3Harris", "LHX", "Industrials", 245, 0.4, 270, 10.2, 2, 0.2, "🟢", "228-238", "⭐⭐⭐", "Defense electronics. Space", 234.44, 216.84, 209.29], [78, "Waste Management", "WM", "Industrials", 220, 0.2, 240, 9.1, 1.3, 0.2, "🟢", "205-213", "⭐⭐", "Waste collection. Defensive", 211.21, 208.73, 194.04], [79, "Costco", "COST", "Consumer Discr.", 950, 0.3, 980, 3.2, 0.5, 0.8, "🟢", "884-922", "⭐⭐", "Membership retail. P/E 50+ expensive", 935.35, 859.59, 809.43], [80, "Home Depot", "HD", "Consumer Discr.", 410, -0.4, 440, 7.3, 2.2, 0.7, "🟡", "381-398", "⭐", "Housing renovation. Div 2.2%", 401.75, 389.11, 384.18], [81, "McDonald's", "MCD", "Consumer Discr.", 295, 0.3, 320, 8.5, 2.3, 0.5, "🟢", "274-286", "⭐⭐", "Fast food #1. Defensive. Div 2.3%", 280.82, 264.6, 244.6], [82, "TJX Companies", "TJX", "Consumer Discr.", 130, 0.2, 140, 7.7, 1.2, 0.3, "🟢", "121-126", "⭐⭐", "Off-price retail. Consumer spending", 126.93, 117.35, 108.11], [83, "Nike", "NKE", "Consumer Discr.", 70, -1.5, 85, 21.4, 1.8, 0.3, "🔴", "65-68", "⭐⭐", "⭐ Deep value. New CEO. -50% от ATH. +21%", 72.52, 78.84, 84.53], [84, "Lowe's", "LOW", "Consumer Discr.", 260, -0.2, 280, 7.7, 1.8, 0.3, "🟡", "242-252", "⭐", "Housing renovation #2", 257.54, 256.73, 242.15], [85, "Starbucks", "SBUX", "Consumer Discr.", 105, 0.4, 115, 9.5, 2.3, 0.3, "🟡", "98-102", "⭐", "Coffee #1. New CEO turnaround", 106.18, 98.26, 100.69], [86, "Booking Holdings", "BKNG", "Consumer Discr.", 4312.44, 0.5, 4500, 4.3, 0.5, 0.3, "🟢", "4011-4183", "⭐⭐", "Online travel monopoly", 4119.62, 3900.33, 3565.22], [87, "Marriott", "MAR", "Consumer Discr.", 260, 0.3, 280, 7.7, 0.8, 0.2, "🟢", "242-252", "⭐⭐", "Hotels #1 global", 254.72, 244.75, 227.03], [88, "Procter & Gamble", "PG", "Consumer Staples", 168, 0.2, 180, 7.1, 2.4, 0.8, "🟢", "156-163", "⭐⭐", "Consumer brands #1. Defensive. Div", 162.02, 152.17, 146.5], [89, "Coca-Cola", "KO", "Consumer Staples", 62, 0.3, 68, 9.7, 2.8, 0.6, "🟢", "58-60", "⭐⭐", "Beverages #1. Div aristocrat. Defensive", 60.22, 56.15, 54.46], [90, "PepsiCo", "PEP", "Consumer Staples", 148, -0.3, 160, 8.1, 3.2, 0.5, "🟢", "138-144", "⭐⭐⭐", "Snacks+drinks. Div 3.2%", 141.97, 134.48, 132.73], [91, "Philip Morris", "PM", "Consumer Staples", 160, 0.4, 175, 9.4, 4.2, 0.4, "🟢", "149-155", "⭐⭐⭐", "IQOS+ZYN. Div 4.2%. Smoke-free pivot", 157.92, 144.8, 131.94], [92, "Walmart", "WMT", "Consumer Staples", 95, 0.3, 100, 5.3, 1, 0.7, "🟢", "88-92", "⭐⭐", "Retail #1. AI logistics. E-commerce growth", 91.12, 86.31, 78.22], [93, "Colgate-Palmolive", "CL", "Consumer Staples", 95, 0.1, 100, 5.3, 2.2, 0.2, "🟢", "88-92", "⭐⭐", "Oral care+home. Defensive", 91.57, 86.43, 84.76], [94, "Mondelez", "MDLZ", "Consumer Staples", 68, -0.4, 75, 10.3, 2.5, 0.2, "🟢", "63-66", "⭐⭐⭐", "Snacks global. Oreo/Cadbury", 64.6, 64.22, 59.22], [95, "Kraft Heinz", "KHC", "Consumer Staples", 32, -0.3, 35, 9.4, 4.5, 0.1, "🟢", "30-31", "⭐⭐⭐", "Food. Div 4.5%. Deep value. Buffett", 31.53, 28.3, 28.13], [96, "General Mills", "GIS", "Consumer Staples", 62, 0.2, 68, 9.7, 3.5, 0.2, "🟢", "58-60", "⭐⭐⭐", "Cereal+snacks. Div 3.5%", 59.83, 57.91, 51.52], [97, "Altria", "MO", "Consumer Staples", 58, 0.3, 62, 6.9, 7.5, 0.2, "🟢", "54-56", "⭐⭐⭐", "⭐ Div 7.5%! Tobacco. NJOY vapes", 57.3, 51.74, 48.77], [98, "ExxonMobil", "XOM", "Energy", 110, 0.3, 120, 9.1, 3.2, 0.8, "🟢", "102-107", "⭐⭐⭐", "Oil #1. Guyana+Permian. Div 3.2%", 105.94, 97.06, 91.54], [99, "Chevron", "CVX", "Energy", 155, 0.2, 170, 9.7, 4, 0.5, "🟢", "144-150", "⭐⭐⭐", "Oil #2. Hess acquisition. Div 4%", 148.44, 142.45, 134.88], [100, "ConocoPhillips", "COP", "Energy", 100, 0.1, 115, 15, 2.8, 0.3, "🟢", "93-97", "⭐⭐⭐", "E&P pure play. Marathon Oil acquired", 96.11, 92.94, 81.47], [101, "EOG Resources", "EOG", "Energy", 130, 0.2, 145, 11.5, 2.5, 0.2, "🟢", "121-126", "⭐⭐⭐", "Shale king. Low cost producer", 124.01, 117.76, 110.48], [102, "Schlumberger", "SLB", "Energy", 42, -0.5, 50, 19, 2.5, 0.2, "🟡", "39-41", "⭐⭐", "Oilfield services #1. Digital", 41.04, 40.5, 39.18], [103, "Baker Hughes", "BKR", "Energy", 45, 0.2, 50, 11.1, 2, 0.2, "🟢", "42-44", "⭐⭐⭐", "LNG+clean energy services", 44.21, 39.89, 40.39], [104, "NextEra Energy", "NEE", "Utilities", 72, 0.3, 80, 11.1, 2.8, 0.3, "🟢", "67-70", "⭐⭐⭐", "⭐ Renewables+utility #1. AI power demand", 69.95, 65.46, 62.92], [105, "Southern Company", "SO", "Utilities", 85, 0.2, 92, 8.2, 3.5, 0.2, "🟢", "79-82", "⭐⭐⭐", "Utility. Nuclear. Div 3.5%", 82.27, 79.85, 69.97], [106, "Duke Energy", "DUK", "Utilities", 110, 0.1, 120, 9.1, 3.8, 0.2, "🟢", "102-107", "⭐⭐⭐", "Utility. Data center demand. Div 3.8%", 105.23, 102.95, 93.14], [107, "Constellation Energy", "CEG", "Utilities", 310, 1.5, 350, 12.9, 0.5, 0.2, "🟢", "288-301", "⭐⭐⭐", "⭐ Nuclear for AI! +12.9% upside", 300.46, 286.17, 268.24], [108, "Exelon", "EXC", "Utilities", 42, 0.3, 45, 7.1, 3.5, 0.1, "🟢", "39-41", "⭐⭐⭐", "Utility. Div 3.5%. Defensive", 41.48, 38.56, 35.67], [109, "Prologis", "PLD", "Real Estate", 115, 0.3, 130, 13, 3.2, 0.3, "🟢", "107-112", "⭐⭐⭐⭐", "Industrial REIT #1. E-commerce logistics", 109.27, 103.34, 99.11], [110, "American Tower", "AMT", "Real Estate", 195, 0.2, 220, 12.8, 3, 0.2, "🟢", "181-189", "⭐⭐⭐⭐", "Cell tower REIT. 5G+data. Div 3%", 189.4, 181.43, 161.29], [111, "Equinix", "EQIX", "Real Estate", 850, 0.4, 920, 8.2, 1.8, 0.2, "🟢", "790-824", "⭐⭐", "⭐ Data center REIT. AI demand!", 824.57, 767.9, 684.62], [112, "Crown Castle", "CCI", "Real Estate", 100, -0.2, 115, 15, 5.5, 0.1, "🟡", "93-97", "⭐⭐⭐", "Cell tower. Div 5.5%", 97.14, 98.04, 92.29], [113, "Digital Realty", "DLR", "Real Estate", 160, 0.3, 180, 12.5, 3, 0.2, "🟢", "149-155", "⭐⭐⭐⭐", "Data center REIT #2. AI capacity", 157.73, 144.55, 134.47], [114, "Netflix", "NFLX", "Comm. Services", 75.86, -0.71, 115, 11.4, 0, 0.5, "🟢", "96-100", "⭐⭐⭐", "Streaming #1. Ad tier+live sports", 98.3, 96.21, 91.35], [115, "Walt Disney", "DIS", "Comm. Services", 110, 0.3, 125, 13.6, 0.8, 0.3, "🟡", "102-107", "⭐⭐", "Streaming+Parks+ESPN. Recovery", 107.59, 106.61, 106.32], [116, "Comcast", "CMCSA", "Comm. Services", 37, 0.3, 42, 13.5, 3, 0.3, "🟢", "34-36", "⭐⭐⭐⭐", "Broadband+NBCUniversal+Peacock. Div 3%", 35.59, 33.32, 32.49], [117, "T-Mobile", "TMUS", "Comm. Services", 275, 0.5, 290, 5.5, 1.2, 0.5, "🟢", "256-267", "⭐⭐", "Wireless #1. Div growing", 265.18, 255.44, 234.39], [118, "Verizon", "VZ", "Comm. Services", 42, 0.2, 46, 9.5, 6.2, 0.3, "🟢", "39-41", "⭐⭐⭐", "⭐ Div 6.2%! Telecom. Defensive income", 40.85, 38.02, 35.8], [119, "AT&T", "T", "Comm. Services", 28, 0.3, 30, 7.1, 5, 0.2, "🟢", "26-27", "⭐⭐⭐", "Div 5%. Fiber+5G. Turnaround", 26.76, 26.05, 25.11], [120, "Linde", "LIN", "Materials", 475, 0.3, 500, 5.3, 1.2, 0.4, "🟢", "442-461", "⭐⭐", "Industrial gas #1. Steady compounder", 458.44, 421.26, 388.28], [121, "Freeport-McMoRan", "FCX", "Materials", 45, -0.5, 52, 15.6, 1, 0.2, "🟡", "42-44", "⭐⭐", "⭐ Copper! EV+AI demand. Cyclical", 44.54, 41.8, 41.14], [122, "Newmont", "NEM", "Materials", 48, 0.4, 55, 14.6, 2, 0.2, "🟢", "45-47", "⭐⭐⭐", "Gold miner #1. Inflation hedge", 47.48, 43.31, 40.24], [123, "Air Products", "APD", "Materials", 290, 0.1, 320, 10.3, 2.5, 0.2, "🟢", "270-281", "⭐⭐⭐", "Industrial gas. Hydrogen. Div 2.5%", 281.44, 259.7, 248.43], [124, "Nucor", "NUE", "Materials", 135, -0.3, 150, 11.1, 1.5, 0.1, "🟡", "126-131", "⭐⭐", "Steel #1 US. Infrastructure", 133.46, 127.37, 129.55]], "subtitle": "S&P 500 ≈ 6,940 | Strong Buy (Daily) | ATH 7,002 (28 Jan) | YTD +2.1% | Consensus YE target: 7,500-8,100", "count": 124}, "DAX 40": {"headers": ["#", "Компания", "Тикер", "Сектор", "Цена", "1д %", "Таргет", "Потенц. %", "Див. %", "Вес %", "SMA", "Покупка", "Рейтинг", "Комментарий", "SMA 50", "SMA 100", "SMA 200"], "rows": [[1, "SAP", "SAP", "Software/AI", 268.42, -5.4, 300, 11.8, 1, 15, "🟡", "250-260", "⭐⭐", "⚠️ -5.4%! AI displacement fears. НО таргет 300 = +12%", 269.29, 273.6, 231.09], [2, "Siemens", "SIE", "Industrials", 215, 6, 230, 7, 2.5, 9, "🟢", "200-209", "⭐⭐", "⭐ +6%! Q1 EPS beat! Raised guidance. Record", 209.33, 198.63, 188.29], [3, "Allianz", "ALV", "Insurance", 315, 0.5, 330, 4.8, 4.5, 7, "🟢", "293-306", "⭐⭐⭐", "Insurance #1 EU. Div 4.5%. Stable", 304.99, 285.92, 276.94], [4, "Deutsche Telekom", "DTE", "Telecom", 32.5, 6.19, 35, 7.7, 3.5, 5.5, "🟢", "30-32", "⭐⭐⭐", "⭐ +6.19% surge! T-Mobile US drives value", 31.93, 29.67, 26.46], [5, "Siemens Energy", "ENR", "Energy/AI", 65, 7.8, 75, 15.4, 0, 4.5, "🟢", "60-63", "⭐⭐⭐", "⭐⭐ +7.8%! Net profit 3x! AI gas turbines!", 63.22, 61.32, 55.25], [6, "Airbus", "AIR", "Aerospace", 175, 0.3, 195, 11.4, 1.2, 4, "🟢", "163-170", "⭐⭐⭐", "Aviation recovery. A320neo backlog record", 172.28, 156.9, 142.3], [7, "Munich Re", "MUV2", "Reinsurance", 560, 0.4, 580, 3.6, 3, 3.8, "🟢", "521-543", "⭐⭐⭐", "Reinsurance #1. Div 3%. Climate risk pricing", 548.27, 520.57, 488.82], [8, "Deutsche Börse", "DB1", "Exchange", 240, 2.9, 260, 8.3, 2, 3.5, "🟢", "223-233", "⭐⭐", "+2.9%. Record earnings. ISS STOXX acquisition", 236.98, 216.25, 199.52], [9, "Mercedes-Benz", "MBG", "Auto", 58, -4.1, 65, 12.1, 7.5, 3.2, "🔴", "54-56", "⭐⭐", "⚠️ -4.1%! Profits decline. Div 7.5% НО risk!", 59.51, 62.84, 69.8], [10, "Infineon", "IFX", "Semis", 33, -0.5, 38, 15.2, 1, 3, "🟡", "31-32", "⭐⭐", "Auto/power semis. Cyclical recovery. +15%", 33.63, 31.59, 32.12], [11, "Rheinmetall", "RHM", "Defense", 1880.0, 1.2, 1700, 7.2, 0.4, 2.8, "🟢", "1475-1538", "⭐⭐", "⭐ EUR defense #1! Panther KF51. NATO boom", 1511.84, 1424.23, 1407.86], [12, "BMW", "BMW", "Auto", 88, -1.5, 95, 8, 5.5, 2.5, "🔴", "82-85", "⭐", "Div 5.5%. EV transition. China weakness", 91.03, 97.89, 97.02], [13, "BASF", "BAS", "Chemicals", 47, -0.8, 50, 6.4, 5, 2.3, "🟡", "44-46", "⭐⭐", "Chemicals #1 EU. Div 5%. Restructuring", 46.85, 44.67, 39.98], [14, "Deutsche Bank", "DBK", "Banking", 22, 0.5, 24, 9.1, 3, 2.2, "🟢", "20-21", "⭐⭐⭐", "Investment bank. Turnaround. Div 3%", 21.24, 19.85, 18.7], [15, "Volkswagen", "VOW3", "Auto", 100, -2, 115, 15, 8, 2, "🔴", "93-97", "⭐⭐", "Div 8%! НО EV transition pain. China decline", 105.16, 114.83, 111.04], [16, "Bayer", "BAYN", "Pharma/Agri", 22.5, -1.5, 25, 11.1, 0, 1.8, "🔴", "21-22", "⭐", "Monsanto litigation drag. Turnaround needed", 23.86, 23.95, 26.27], [17, "Adidas", "ADS", "Sportswear", 240, 0.2, 260, 8.3, 1, 1.7, "🟢", "223-233", "⭐⭐", "Comeback story. Running boom. China recovery", 232.83, 221.94, 193.4], [18, "Hannover Rück", "HNR1", "Reinsurance", 275, 2.87, 290, 5.5, 3.5, 1.6, "🟢", "256-267", "⭐⭐⭐", "+2.87%. Reinsurance #2. Div 3.5%", 261.41, 255.71, 241.84], [19, "Porsche SE", "PAH3", "Auto Holding", 35, -0.5, 40, 14.3, 5, 1.5, "🟡", "33-34", "⭐⭐⭐", "VW holding. Div 5%. Discount to NAV", 34.23, 35.2, 32.92], [20, "Henkel", "HEN3", "Consumer", 82, 0.3, 88, 7.3, 2.5, 1.4, "🟢", "76-80", "⭐⭐", "Adhesives+consumer brands. Stable", 80.67, 76.74, 72.78], [21, "Deutsche Post/DHL", "DHL", "Logistics", 35, -5.07, 40, 14.3, 4, 1.3, "🔴", "33-34", "⭐⭐", "⚠️ -5.07%! Logistics slowdown. Div 4%", 35.51, 39.53, 39.54], [22, "E.ON", "EOAN", "Utilities", 12.5, 0.4, 14, 12, 4.5, 1.2, "🟢", "12-12", "⭐⭐⭐⭐", "Energy utility. Div 4.5%. Green transition", 12.08, 11.03, 10.06], [23, "RWE", "RWE", "Utilities", 29, -4.1, 35, 20.7, 3, 1.1, "🔴", "27-28", "⭐⭐⭐", "⚠️ -4.1%! Renewable utility. EU emissions reform", 30.53, 30.83, 32.01], [24, "Merck KGaA", "MRK", "Pharma/Tech", 145, 0.3, 160, 10.3, 1.2, 1, "🟢", "135-141", "⭐⭐⭐", "Pharma+electronics materials. +10%", 140.93, 128.02, 125.0], [25, "Heidelberg Materials", "HEI", "Building Mat.", 112, -11.57, 130, 16.1, 3.5, 1, "🔴", "104-109", "⭐⭐", "⚠️ CRASH -11.57%! EU emissions reform hit", 119.74, 122.65, 126.93], [26, "Beiersdorf", "BEI", "Consumer", 130, 0.2, 140, 7.7, 0.8, 0.9, "🟢", "121-126", "⭐⭐", "Nivea+La Prairie. Stable", 126.76, 122.88, 111.58], [27, "Symrise", "SY1", "Flavors/Frag.", 110, 0.1, 120, 9.1, 1, 0.8, "🟢", "102-107", "⭐⭐", "Flavors & fragrances. Niche", 108.71, 100.46, 88.27], [28, "Fresenius", "FRE", "Healthcare", 38, 0.5, 42, 10.5, 2, 0.8, "🟢", "35-37", "⭐⭐⭐", "Hospital operator. Turnaround", 37.08, 35.82, 33.28], [29, "Vonovia", "VNA", "Real Estate", 28, 0.3, 32, 14.3, 3, 0.7, "🟢", "26-27", "⭐⭐⭐⭐", "Residential REIT. Rate cut play. Div 3%", 26.6, 24.73, 23.71], [30, "Sartorius", "SRT3", "Biotech equip", 230, -1, 260, 13, 0.5, 0.7, "🔴", "214-223", "⭐", "Lab equipment. Biotech capex cycle", 236.53, 258.64, 254.23], [31, "Commerzbank", "CBK", "Banking", 18.5, 0.8, 20, 8.1, 3.5, 0.6, "🟢", "17-18", "⭐⭐⭐", "UniCredit takeover target? Div 3.5%", 18.29, 16.42, 15.76], [32, "Puma", "PUM", "Sportswear", 22, -0.5, 26, 18.2, 1.5, 0.5, "🟡", "20-21", "⭐⭐", "Sportswear. Recovery. Adidas shadow", 21.98, 20.31, 18.73], [33, "Brenntag", "BNR", "Chem Distrib.", 60, -0.3, 68, 13.3, 3, 0.5, "🟡", "56-58", "⭐⭐⭐", "Chemical distribution. Cyclical", 59.56, 61.36, 51.81], [34, "Siemens Healthineers", "SHL", "Med Devices", 50, 0.4, 55, 10, 1.5, 0.5, "🟢", "46-48", "⭐⭐", "Medical imaging. Varian cancer", 49.04, 47.02, 41.58], [35, "Zalando", "ZAL", "E-commerce", 32, 0.3, 38, 18.8, 0, 0.4, "🟢", "30-31", "⭐⭐⭐", "Fashion e-comm. About.You merger", 30.44, 30.12, 27.55], [36, "Scout24", "G24", "Real Estate Tech", 82, -5.56, 92, 12.2, 1, 0.4, "🔴", "76-80", "⭐", "-5.56%. ImmoScout. German RE platform", 85.23, 86.62, 98.57], [37, "Qiagen", "QIA", "Diagnostics", 42, 0.2, 46, 9.5, 0, 0.4, "🟡", "39-41", "⭐", "Molecular diagnostics. Steady", 42.2, 38.75, 39.02], [38, "Covestro", "1COV", "Chemicals", 58, -0.5, 62, 6.9, 0, 0.3, "🟡", "54-56", "⭐", "ADNOC takeover target. Plastics", 56.88, 57.98, 49.6], [39, "Continental", "CON", "Auto Parts", 65, -1.2, 75, 15.4, 3, 0.3, "🔴", "60-63", "⭐⭐", "Auto parts. EV transition. Div 3%. Cyclical", 66.94, 70.08, 77.89], [40, "Porsche AG", "P911", "Luxury Auto", 62, -0.8, 75, 21, 2.5, 0.3, "🔴", "58-60", "⭐⭐", "Luxury sports cars. 911+Taycan. -decline", 65.73, 66.15, 69.73]], "subtitle": "DAX = 24,853 (-0.01%) | Strong Buy | ATH 25,508 (5 Feb) | YTD +1.1% | Consensus YE: 25,000-27,500", "count": 40}, "CAC 40": {"headers": ["#", "Компания", "Тикер", "Сектор", "Цена", "1д %", "Таргет", "Потенц. %", "Див. %", "Вес %", "SMA", "Покупка", "Рейтинг", "Комментарий", "SMA 50", "SMA 100", "SMA 200"], "rows": [[1, "LVMH", "MC", "Luxury", 715, -0.5, 800, 11.9, 1.8, 12, "🟡", "665-694", "⭐⭐", "Luxury #1 global. China mixed. Louis Vuitton+Dior", 694.82, 700.2, 678.37], [2, "TotalEnergies", "TTE", "Energy", 55, 0.3, 62, 12.7, 5, 7.5, "🟢", "51-53", "⭐⭐⭐⭐", "Oil #1 EU. Div 5%. LNG+renewables pivot", 52.76, 50.61, 46.08], [3, "Schneider Electric", "SU", "Industrials", 252, 0.4, 280, 11.1, 1.5, 6, "🟢", "234-244", "⭐⭐⭐", "⭐ Electrification+automation. AI data center power", 246.76, 222.22, 215.39], [4, "Sanofi", "SAN", "Pharma", 102, 0.5, 115, 12.7, 3.5, 5, "🟢", "95-99", "⭐⭐⭐⭐", "Dupixent blockbuster. Div 3.5%. +13%", 100.77, 90.08, 83.68], [5, "Airbus", "AIR", "Aerospace", 175, 0.3, 195, 11.4, 1.2, 4.5, "🟢", "163-170", "⭐⭐⭐", "A320neo backlog. Aviation boom", 172.28, 156.9, 142.3], [6, "Air Liquide", "AI", "Industrial Gas", 175, 0.2, 190, 8.6, 1.8, 4, "🟢", "163-170", "⭐⭐", "Industrial gas. Hydrogen. Steady compounder", 173.11, 166.18, 146.74], [7, "L'Oréal", "OR", "Beauty", 360, -0.3, 400, 11.1, 1.5, 3.8, "🟡", "335-349", "⭐⭐", "Beauty #1 global. Dermalogical growth", 349.89, 362.55, 338.24], [8, "BNP Paribas", "BNP", "Banking", 68, 0.4, 72, 5.9, 6, 3.5, "🟢", "63-66", "⭐⭐⭐", "Bank #1 EU. Div 6%. Investment banking", 64.87, 63.4, 57.3], [9, "Hermès", "RMS", "Luxury", 2500, 0.2, 2600, 4, 0.5, 3.5, "🟢", "2325-2425", "⭐⭐", "Ultra-luxury. Birkin bags. P/E 55+", 2420.46, 2295.59, 2051.93], [10, "EssilorLuxottica", "EL", "Eyewear", 260, 0.3, 280, 7.7, 1.5, 3, "🟢", "242-252", "⭐⭐", "Eyewear+lenses monopoly. RayBan Meta", 250.26, 234.23, 216.01], [11, "Safran", "SAF", "Aerospace/Def", 240, 0.5, 270, 12.5, 1, 2.8, "🟢", "223-233", "⭐⭐⭐", "⭐ LEAP engines. Defense. +12.5% upside", 234.92, 223.89, 211.73], [12, "Vinci", "DG", "Infrastructure", 115, 0.2, 125, 8.7, 3.5, 2.5, "🟢", "107-112", "⭐⭐⭐", "Infrastructure+airports+construction. Div 3.5%", 111.81, 106.98, 96.32], [13, "AXA", "CS", "Insurance", 38, 0.3, 42, 10.5, 5.5, 2.3, "🟢", "35-37", "⭐⭐⭐⭐", "Insurance #2 EU. Div 5.5%. Undervalued", 36.52, 34.55, 30.96], [14, "Dassault Systèmes", "DSY", "Software", 35, -0.5, 40, 14.3, 0.5, 2.2, "🟡", "33-34", "⭐⭐", "3D design software. Industrial metaverse", 34.6, 32.91, 33.47], [15, "Thales", "HO", "Defense/Tech", 185, 0.8, 210, 13.5, 2, 2, "🟢", "172-179", "⭐⭐⭐", "⭐ Defense + cybersecurity. NATO orders. +13.5%", 182.3, 168.76, 161.53], [16, "Saint-Gobain", "SGO", "Building Mat.", 90, 0.1, 100, 11.1, 2.5, 1.8, "🟢", "84-87", "⭐⭐⭐", "Building materials. Green renovation", 88.38, 83.57, 76.23], [17, "Société Générale", "GLE", "Banking", 38, 0.5, 42, 10.5, 6.5, 1.7, "🟢", "35-37", "⭐⭐⭐⭐", "Banking. Div 6.5%! Turnaround", 36.22, 34.5, 33.95], [18, "Danone", "BN", "Consumer", 62, 0.2, 68, 9.7, 3.5, 1.6, "🟢", "58-60", "⭐⭐⭐", "Yogurt+water+baby food. Div 3.5%", 60.78, 57.32, 54.03], [19, "Engie", "ENGI", "Utilities", 16.5, 0.3, 18, 9.1, 5.5, 1.5, "🟢", "15-16", "⭐⭐⭐", "Energy utility. Div 5.5%. Nuclear+gas", 16.21, 15.28, 14.49], [20, "Pernod Ricard", "RI", "Spirits", 105, -1.2, 120, 14.3, 3, 1.4, "🔴", "98-102", "⭐⭐", "⭐ Spirits. -1.2%. China tariffs fear. +14%", 111.38, 112.95, 123.74], [21, "Stellantis", "STLAM", "Auto", 12, -2.5, 15, 25, 8, 1.3, "🔴", "11-12", "⭐⭐⭐", "Div 8%! НО struggling. Fiat+Peugeot+Chrysler", 12.49, 12.91, 13.28], [22, "Michelin", "ML", "Tires", 35, 0.1, 38, 8.6, 3.5, 1.2, "🟢", "33-34", "⭐⭐⭐", "Tires #1. Div 3.5%. Steady", 34.61, 30.81, 28.15], [23, "Crédit Agricole", "ACA", "Banking", 15, 0.4, 17, 13.3, 6, 1.1, "🟢", "14-15", "⭐⭐⭐⭐", "Retail banking. Div 6%. +13%", 14.51, 13.97, 13.17], [24, "Capgemini", "CAP", "IT Consulting", 170, -0.5, 190, 11.8, 2, 1, "🟡", "158-165", "⭐⭐", "IT services. AI consulting. +12%", 169.37, 164.53, 144.72], [25, "Kering", "KER", "Luxury", 220, -1.5, 260, 18.2, 3, 0.9, "🔴", "205-213", "⭐⭐", "⭐ Gucci turnaround. -1.5%. Deep value. +18%", 226.79, 232.77, 267.3], [26, "Bouygues", "EN", "Conglomerate", 34, 0.3, 38, 11.8, 5, 0.8, "🟢", "32-33", "⭐⭐⭐⭐", "Telecom+construction. Div 5%", 33.55, 31.88, 29.59], [27, "Veolia", "VIE", "Utilities/Water", 28, 0.2, 32, 14.3, 3.5, 0.8, "🟢", "26-27", "⭐⭐⭐⭐", "Water+waste #1 global. Div 3.5%", 26.81, 25.28, 23.94], [28, "Orange", "ORA", "Telecom", 12, 0.3, 13, 8.3, 7, 0.7, "🟢", "11-12", "⭐⭐⭐", "⭐ Telecom. Div 7%! Highest in CAC", 11.79, 11.32, 10.12], [29, "Renault", "RNO", "Auto", 50, 0.4, 55, 10, 5, 0.6, "🟢", "46-48", "⭐⭐⭐", "Auto turnaround. Div 5%. EV push", 48.89, 46.12, 43.93], [30, "Publicis", "PUB", "Advertising", 100, 0.2, 110, 10, 2.5, 0.6, "🟢", "93-97", "⭐⭐", "Ad holding #1 EU. AI-driven ads", 95.84, 91.59, 89.89], [31, "Legrand", "LR", "Electricals", 100, 0.1, 108, 8, 2, 0.5, "🟢", "93-97", "⭐⭐", "Electrical installations. Data center", 96.76, 90.45, 81.06], [32, "Unibail-Rodamco", "URW", "Real Estate", 72, 0.5, 85, 18.1, 5, 0.4, "🟢", "67-70", "⭐⭐⭐⭐", "Shopping centers. Rate cut play. Div 5%", 70.13, 67.67, 60.84], [33, "Edenred", "EDEN", "HR Services", 33, -0.3, 38, 15.2, 2, 0.4, "🟡", "31-32", "⭐⭐", "Meal vouchers. Fintech. +15%", 33.66, 33.47, 31.34], [34, "Vivendi", "VIV", "Media", 2.8, 0, 3.5, 25, 0, 0.3, "🟡", "3-3", "⭐⭐⭐", "Canal+/Havas spun off. Value unlock", 2.75, 2.82, 2.51], [35, "Arkema", "AKE", "Chemicals", 75, -0.4, 85, 13.3, 3, 0.3, "🟡", "70-73", "⭐⭐⭐", "Specialty chemicals. Cyclical recovery", 73.11, 69.94, 68.29], [36, "Accor", "AC", "Hotels", 42, 0.3, 48, 14.3, 2, 0.3, "🟢", "39-41", "⭐⭐⭐", "Hotels #1 EU. Luxury pivot", 40.85, 39.87, 35.43], [37, "Worldline", "WLN", "Payments", 7.5, -1.5, 10, 33.3, 0, 0.2, "🔴", "7-7", "⭐⭐", "⚠️ Payments. Troubled. Deep value? +33%", 7.89, 8.53, 8.57], [38, "Teleperformance", "TEP", "Outsourcing", 85, -0.5, 100, 17.6, 3, 0.2, "🟡", "79-82", "⭐⭐⭐", "Customer service. AI disruption risk. +18%", 86.23, 85.46, 73.45], [39, "Eurofins Scientific", "ERF", "Lab Testing", 50, 0.2, 58, 16, 1, 0.2, "🟢", "46-48", "⭐⭐⭐", "Food/pharma testing. Steady", 49.32, 44.84, 44.4], [40, "Dassault Aviation", "AM", "Defense/Jets", 290, 0.6, 330, 13.8, 1, 0.2, "🟢", "270-281", "⭐⭐⭐", "⭐ Rafale fighter jets. EU defense! +14%", 283.56, 257.18, 235.04]], "subtitle": "CAC 40 = 8,344 (+0.19%) | Buy | ATH зона | YTD +5.2% | Luxury + Defense + Energy", "count": 40}, "FTSE MIB": {"headers": ["#", "Компания", "Тикер", "Сектор", "Цена", "1д %", "Таргет", "Потенц. %", "Див. %", "Вес %", "SMA", "Покупка", "Рейтинг", "Комментарий", "SMA 50", "SMA 100", "SMA 200"], "rows": [[1, "UniCredit", "UCG", "Banking", 48, 1.2, 52, 8.3, 5.5, 8, "🟢", "45-47", "⭐⭐⭐", "⭐ Bank #1 IT. Div 5.5%. Commerzbank bid", 46.5, 42.5, 40.15], [2, "Intesa Sanpaolo", "ISP", "Banking", 4.2, 0.8, 4.5, 7.1, 7, 7.5, "🟢", "4-4", "⭐⭐⭐", "⭐ Div 7%! Bank #2 IT. Wealth management", 4.13, 3.77, 3.7], [3, "Ferrari", "RACE", "Luxury Auto", 420, 0.3, 450, 7.1, 0.6, 6, "🟢", "391-407", "⭐⭐", "Luxury supercar. P/E 55+. EV roadmap", 403.96, 381.05, 370.94], [4, "Enel", "ENEL", "Utilities", 7.2, 0.4, 7.8, 8.3, 5.5, 5.5, "🟢", "7-7", "⭐⭐⭐", "⭐ Utility. Div 5.5%. Renewables. Global", 7.0, 6.8, 6.06], [5, "Leonardo", "LDO", "Defense/Aero", 53.78, 2.87, 58, 7.8, 1, 5, "🟢", "50-52", "⭐⭐", "⭐ +2.87%! Helicopters+defense. +300% за 3 года!", 52.66, 49.75, 44.08], [6, "Stellantis", "STLAM", "Auto", 12, -2.5, 15, 25, 8, 4.5, "🔴", "11-12", "⭐⭐⭐", "Div 8%! НО struggling. Fiat+Alfa+Maserati", 12.49, 12.91, 13.28], [7, "Eni", "ENI", "Energy", 13.5, 0.4, 15, 11.1, 6.5, 4, "🟢", "13-13", "⭐⭐⭐⭐", "⭐ Oil+gas. Div 6.5%. LNG. Transition", 13.21, 12.22, 11.33], [8, "Generali", "G", "Insurance", 30, 0.5, 33, 10, 5, 3.5, "🟢", "28-29", "⭐⭐⭐", "Insurance #1 IT. Div 5%. Acquisitions", 29.05, 26.85, 25.04], [9, "STMicroelectronics", "STMF", "Semis", 24, -1.5, 28, 16.7, 1.5, 3, "🔴", "22-23", "⭐", "Auto+industrial chips. Cyclical recovery. +17%", 25.62, 27.53, 26.96], [10, "Prysmian", "PRY", "Cables", 60, 0.3, 68, 13.3, 1.5, 2.8, "🟢", "56-58", "⭐⭐⭐", "Cables #1 global. Grid investment. +13%", 57.59, 54.32, 52.15], [11, "Moncler", "MONC", "Luxury", 58, -0.5, 65, 12.1, 1.5, 2.5, "🟡", "54-56", "⭐⭐", "Luxury down jackets. China exposure", 58.47, 59.02, 55.02], [12, "Tenaris", "TEN", "Steel Pipes", 18, 0.3, 20, 11.1, 3, 2.3, "🟢", "17-17", "⭐⭐⭐⭐", "Oil&gas pipes. Energy capex. Div 3%", 17.74, 16.98, 15.52], [13, "Campari", "CPR", "Spirits", 6.5, -0.8, 7.5, 15.4, 1.5, 2, "🟡", "6-6", "⭐⭐", "Spirits. Aperol. -0.8%. +15% upside", 6.41, 6.18, 5.59], [14, "Finecobank", "FBK", "Banking", 16.5, 0.4, 18, 9.1, 3.5, 2, "🟢", "15-16", "⭐⭐⭐", "Digital bank. Div 3.5%. Growth+income", 16.14, 14.62, 14.25], [15, "Mediobanca", "MB", "Banking", 16, 0.8, 17.5, 9.4, 5, 1.8, "🟢", "15-16", "⭐⭐⭐", "Investment bank IT. Div 5%", 15.24, 14.52, 13.81], [16, "Banco BPM", "BAMI", "Banking", 8.5, 0.6, 9.5, 11.8, 5.5, 1.7, "🟢", "8-8", "⭐⭐⭐⭐", "Regional bank. Div 5.5%. UniCredit bid target", 8.11, 7.51, 7.26], [17, "Fincantieri", "FCT", "Shipbuilding", 16.5, 2.87, 20, 21.2, 0, 1.5, "🟢", "15-16", "⭐⭐⭐⭐", "⭐ +2.87%! Naval defense. Submarines+frigates", 16.02, 15.35, 13.86], [18, "MPS (Banca Monte Paschi)", "BMPS", "Banking", 7, 1.5, 7.8, 11.4, 4, 1.5, "🟢", "7-7", "⭐⭐⭐⭐", "⭐ +1.5%! Turnaround complete. Div 4%", 6.85, 6.39, 5.68], [19, "Recordati", "REC", "Pharma", 52, 0.3, 56, 7.7, 2.5, 1.3, "🟢", "48-50", "⭐⭐", "Specialty pharma. Rare diseases. Steady", 51.27, 47.79, 43.32], [20, "Pirelli", "PIRC", "Tires", 5.5, 0.2, 6.2, 12.7, 3.5, 1.2, "🟢", "5-5", "⭐⭐⭐⭐", "Premium tires. Div 3.5%. China risk", 5.25, 5.07, 4.87], [21, "Telecom Italia", "TIT", "Telecom", 0.3, 0, 0.38, 26.7, 0, 1, "🟡", "0-0", "⭐⭐⭐", "Telecom. NetCo sold. Turnaround? +27%", 0.3, 0.3, 0.28], [22, "Amplifon", "AMP", "Hearing aids", 22, -1, 26, 18.2, 1, 0.9, "🔴", "20-21", "⭐", "Hearing aids #1. Demographics. +18%", 23.04, 25.19, 25.71], [23, "DiaSorin", "DIA", "Diagnostics", 95, 0.3, 110, 15.8, 1.5, 0.8, "🟢", "88-92", "⭐⭐⭐", "Molecular diagnostics. Niche", 90.33, 86.93, 76.44], [24, "Nexi", "NEXI", "Payments", 5.8, -0.5, 7, 20.7, 0, 0.8, "🟡", "5-6", "⭐⭐⭐", "⭐ Payments IT #1. Deep value. +21%", 5.76, 5.73, 5.11], [25, "BPER Banca", "BPE", "Banking", 6.5, 0.6, 7.2, 10.8, 5, 0.7, "🟢", "6-6", "⭐⭐⭐⭐", "Regional bank. Div 5%. Consolidation", 6.27, 6.17, 5.7], [26, "A2A", "A2A", "Utilities", 2.2, 0.3, 2.5, 13.6, 4.5, 0.7, "🟢", "2-2", "⭐⭐⭐⭐", "Multi-utility. Div 4.5%. Lombardy", 2.14, 1.97, 1.9], [27, "Snam", "SRG", "Gas Infra", 4.8, 0.2, 5.2, 8.3, 5.5, 0.7, "🟢", "4-5", "⭐⭐⭐", "Gas pipelines. Div 5.5%. Hydrogen ready", 4.74, 4.48, 4.14], [28, "Terna", "TRN", "Grid", 8.2, 0.3, 8.8, 7.3, 4, 0.6, "🟢", "8-8", "⭐⭐⭐", "Electricity grid. Div 4%. Regulated. Safe", 8.05, 7.49, 7.14], [29, "Italgas", "IG", "Gas Distrib", 5.8, 0.2, 6.3, 8.6, 4.5, 0.5, "🟢", "5-6", "⭐⭐⭐", "Gas distribution. Div 4.5%. Regulated", 5.6, 5.22, 5.15], [30, "Hera", "HER", "Utilities", 3.6, 0.3, 4, 11.1, 3.5, 0.5, "🟢", "3-3", "⭐⭐⭐⭐", "Multi-utility Emilia. Div 3.5%", 3.55, 3.3, 3.14], [31, "Inwit", "INW", "Telecom Tower", 10, 0.1, 11, 10, 5, 0.5, "🟢", "9-10", "⭐⭐⭐", "Tower company. Div 5%. 5G/AI demand", 9.72, 8.85, 8.52], [32, "Saipem", "SPM", "Oil Services", 2.3, 0.5, 2.8, 21.7, 0, 0.4, "🟢", "2-2", "⭐⭐⭐⭐", "⭐ Offshore engineering. Turnaround. +22%", 2.23, 2.03, 2.0], [33, "Interpump", "IP", "Hydraulics", 42, -0.5, 48, 14.3, 1, 0.4, "🟡", "39-41", "⭐⭐", "Hydraulic pumps. Niche industrial", 42.77, 38.79, 40.1], [34, "Brunello Cucinelli", "BC", "Luxury", 96, 0.3, 105, 9.4, 0.8, 0.4, "🟢", "89-93", "⭐⭐", "Ultra-luxury cashmere. Made in Italy", 94.51, 90.26, 82.64], [35, "Buzzi", "BZU", "Cement", 42, -2, 48, 14.3, 2, 0.3, "🔴", "39-41", "⭐", "Cement. -2%. EU emissions reform", 42.8, 45.39, 46.55], [36, "ERG", "ERG", "Renewables", 20, 0.3, 24, 20, 3, 0.3, "🟢", "19-19", "⭐⭐⭐⭐", "Wind+solar. Green energy. Div 3%", 19.64, 18.06, 16.26], [37, "Banca Popolare Sondrio", "BPSO", "Banking", 9, 0.5, 10, 11.1, 4, 0.3, "🟢", "8-9", "⭐⭐⭐⭐", "Regional bank. Div 4%", 8.74, 8.03, 7.4], [38, "Iveco Group", "IVG", "Trucks", 14, 0.4, 17, 21.4, 2, 0.3, "🟢", "13-14", "⭐⭐⭐⭐", "⭐ Trucks+defense vehicles. +21% upside", 13.62, 12.58, 12.0], [39, "Azimut", "AZM", "Asset Mgmt", 26, 0.3, 29, 11.5, 6, 0.3, "🟢", "24-25", "⭐⭐⭐⭐", "⭐ Asset management. Div 6%! Fintech", 25.39, 23.11, 21.51], [40, "Poste Italiane", "PST", "Post/Insurance", 14, 0.2, 15.5, 10.7, 5, 0.3, "🟢", "13-14", "⭐⭐⭐⭐", "Post+insurance+payments. Div 5%. Stable", 13.46, 12.79, 12.24]], "subtitle": "FTSE MIB = 38,200 (+0.77%) | Strong Buy | ATH зона | YTD +7.5% | Banks + Defense + Dividends", "count": 40}, "OBX 25": {"headers": ["#", "Компания", "Тикер", "Сектор", "Цена NOK", "1д %", "Таргет", "Потенц. %", "Див. %", "Вес %", "SMA", "Покупка", "Рейтинг", "Комментарий", "SMA 50", "SMA 100", "SMA 200"], "rows": [[1, "Equinor", "EQNR", "Energy/Oil", 290, 0.5, 320, 10.3, 8, 15, "🟢", "270-281", "⭐⭐⭐⭐⭐", "⭐ Oil #1 Norway. Div 8%! Johan Sverdrup. +10%", 286.76, 274.0, 235.59], [2, "DNB Bank", "DNB", "Banking", 235, 0.8, 250, 6.4, 5.5, 10, "🟢", "219-228", "⭐⭐⭐⭐", "Bank #1 Norway. Div 5.5%. Mortgage king", 226.6, 222.5, 204.13], [3, "Kongsberg Gruppen", "KOG", "Defense/Marine", 1200.0, 1.5, 1400, 16.7, 1, 6, "🟢", "1116-1164", "⭐⭐⭐", "⭐ Defense + maritime. NASAMS. +17%!", 1141.4, 1111.65, 974.99], [4, "Norsk Hydro", "NHY", "Aluminium", 60, -0.5, 68, 13.3, 5, 5, "🟡", "56-58", "⭐⭐⭐⭐", "Aluminium. Div 5%. Green metal. +13%", 60.8, 57.85, 56.23], [5, "Telenor", "TEL", "Telecom", 130, 0.3, 140, 7.7, 6.5, 4.5, "🟢", "121-126", "⭐⭐⭐⭐", "Nordic telecom. Div 6.5%. Asia exit", 124.69, 116.76, 113.77], [6, "Mowi", "MOWI", "Salmon farming", 185, -1.2, 200, 8.1, 4.5, 4, "🟡", "172-179", "⭐⭐", "Salmon #1 global. Div 4.5%. Tax risk", 181.96, 171.84, 161.18], [7, "Yara International", "YAR", "Fertilizers", 290, -0.3, 320, 10.3, 4, 3.5, "🟡", "270-281", "⭐⭐⭐", "Fertilizer #1 EU. Div 4%. Green ammonia", 285.47, 270.04, 270.44], [8, "Aker BP", "AKRBP", "Energy/E&P", 225, 0.4, 260, 15.6, 10, 3.5, "🟢", "209-218", "⭐⭐⭐⭐⭐", "⭐ Div 10%! E&P #2 Norway. High yield king", 216.57, 209.64, 199.63], [9, "Gjensidige", "GJF", "Insurance", 195, 0.2, 210, 7.7, 5.5, 3, "🟢", "181-189", "⭐⭐⭐⭐", "Insurance #1 Norway. Div 5.5%. Stable", 188.95, 178.94, 174.41], [10, "Orkla", "ORK", "Consumer", 95, 0.1, 105, 10.5, 3.5, 2.5, "🟢", "88-92", "⭐⭐⭐⭐", "Consumer brands Nordic. Div 3.5%. Steady", 93.48, 84.7, 77.15], [11, "Storebrand", "STB", "Insurance/Pens", 115, 0.6, 125, 8.7, 4, 2.5, "🟢", "107-112", "⭐⭐⭐", "Life insurance+pensions. Div 4%. ESG", 109.51, 108.63, 94.43], [12, "Salmar", "SALM", "Salmon farming", 600, -0.8, 650, 8.3, 4, 2, "🟡", "558-582", "⭐⭐", "Salmon #2. Div 4%. Arctic offshore farms", 586.25, 615.88, 585.59], [13, "Tomra Systems", "TOM", "Recycling", 140, -2.5, 165, 17.9, 1.5, 2, "🔴", "130-136", "⭐", "⭐ Reverse vending. Recycling. +18% upside", 144.56, 148.64, 162.73], [14, "BW LPG", "BWLPG", "LPG Shipping", 157, 0.3, 170, 8.3, 12, 1.5, "🟢", "146-152", "⭐⭐⭐⭐", "⭐⭐ Div 12%! LPG tankers. #1 dividend", 154.98, 144.96, 131.23], [15, "Frontline", "FRO", "Tankers", 180, -1, 200, 11.1, 8, 1.5, "🟡", "167-175", "⭐⭐⭐⭐", "Crude tankers. Div 8%. Volatile", 177.26, 180.89, 171.4], [16, "Autostore", "AUTO", "Robotics/Warehouse", 16, -3.5, 22, 37.5, 0, 1.5, "🔴", "15-16", "⭐⭐", "⭐ Warehouse robotics. -3.5%. Deep value. +38%!", 16.24, 16.94, 17.45], [17, "Vår Energi", "VAR", "Energy/E&P", 38, 0.5, 42, 10.5, 9, 1.5, "🟢", "35-37", "⭐⭐⭐⭐⭐", "⭐ Div 9%! E&P. Eni subsidiary. Stable production", 37.27, 33.96, 32.73], [18, "Bakkafrost", "BAKKA", "Salmon farming", 540, 0.2, 580, 7.4, 2.5, 1.2, "🟢", "502-524", "⭐⭐", "Faroese salmon. Premium quality. +7%", 528.87, 484.24, 455.16], [19, "Aker Solutions", "AKSO", "Oil Services", 38, -0.5, 45, 18.4, 3, 1, "🟡", "35-37", "⭐⭐⭐", "Subsea+renewables engineering. +18%", 37.21, 37.85, 32.69], [20, "Wallenius Wilhelmsen", "WAWI", "RoRo Shipping", 125, 0.4, 140, 12, 5, 1, "🟢", "116-121", "⭐⭐⭐⭐⭐", "Car carrier shipping. Div 5%. +12%", 121.81, 114.37, 106.48], [21, "Schibsted", "SCHA", "Media/Classifieds", 395, 0.5, 430, 8.9, 0.5, 1, "🟢", "367-383", "⭐⭐", "Media + online classifieds (Finn.no). +9%", 390.56, 353.65, 318.82], [22, "Nel ASA", "NEL", "Hydrogen", 3.5, -2, 5, 42.9, 0, 0.8, "🔴", "3-3", "⭐⭐", "⚠️ Hydrogen. Speculative. Loss-making. +43% IF recovery", 3.59, 3.89, 4.23], [23, "Hafnia", "HAFNI", "Tankers", 65, 0.3, 72, 10.8, 10, 0.8, "🟢", "60-63", "⭐⭐⭐⭐⭐", "⭐ Product tankers. Div 10%! Strong cash flow", 63.45, 57.45, 53.93], [24, "Austevoll Seafood", "AUSS", "Seafood", 80, -0.5, 92, 15, 4.5, 0.6, "🟡", "74-78", "⭐⭐⭐", "Pelagic fish + salmon ownership. Div 4.5%", 81.41, 79.83, 75.95]], "subtitle": "OBX = 1,613 (+0.29%) | Strong Buy | ATH зона | Energy + Shipping + Defense + Div yield лучший в EU", "count": 24}, "💼 Портфель 2.0": {"headers": ["#", "Компания", "Тикер", "Страна", "Сектор", "Тип", "Кол-во", "Цена", "Валюта", "Покупка", "1д %", "Прибыль kr", "От покупки %", "Стоимость kr", "X-dag", "Выплата дивид.", "SMA 50", "SMA 100", "SMA 200", "Целевая kr", "Цель %", "Действие"], "rows": [[1, "Micron Technology", "MU", "🇺🇸", "Полупроводники", "🚀 Рост", 4, 762.1, "USD", 416.21, 4.11, 12355, 83.1, 27222, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [2, "Rheinmetall", "RHM", "🇩🇪", "Оборона", "🛡️ Рост", 2, 1222.2, "EUR", 1196.6, 1.06, 542, 2.14, 25886, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [3, "Workday A", "WDAY", "🇺🇸", "Software/HR", "💻 Рост", 15, 121.85, "USD", 122.73, -3.76, -118, -0.72, 16322, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [4, "Dellia Group", "DELLIA", "🇳🇴", "Промышленность", "🚀 Рост", 39, 395.0, "NOK", 209.75, 3.4, 6773, 88.32, 14442, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [5, "Booking", "BKNG", "🇺🇸", "Путешествия", "🌐 Рост", 10, 159.68, "USD", 156.55, 1.74, 279, 2.0, 14259, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [6, "Solid Försäkring", "SFAB", "🇸🇪", "Страхование", "🛡️ Дивидендная", 135, 96.2, "SEK", 100.92, -1.74, -637, -4.68, 12987, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [7, "Microsoft", "MSFT", "🇺🇸", "Software/Cloud", "💻 Качество", 3, 419.09, "USD", 373.04, -0.47, 1233, 12.34, 11227, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [8, "Realty Income REIT", "O", "🇺🇸", "Недвижимость (REIT)", "🏠 Дивидендная", 20, 62.23, "USD", 66.11, -0.02, -693, -5.87, 11114, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [9, "Meta Platforms A", "META", "🇺🇸", "Соцсети / AI", "🤖 Рост", 2, 607.38, "USD", 573.42, 0.38, 607, 5.92, 10848, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [10, "CellaVision", "CEVI", "🇸🇪", "Мед. техника", "🔬 Рост", 90, 122.4, "SEK", 123.23, -1.61, -75, -0.67, 11016, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [11, "Alphabet Inc Class C", "GOOG", "🇺🇸", "Search / Cloud", "🤖 Рост", 3, 383.47, "USD", 288.0, -0.37, 2557, 33.15, 10273, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [12, "NVIDIA", "NVDA", "🇺🇸", "ИИ / Чипы", "🤖 Рост", 5, 219.51, "USD", 174.1, -1.77, 2027, 26.08, 9801, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [13, "Strategy A", "MSTR", "🇺🇸", "Bitcoin / Software", "⚡ Спекулятивная", 5, 164.85, "USD", 133.2, -0.58, 1414, 23.76, 7361, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [14, "Microchip Technology", "MCHP", "🇺🇸", "Полупроводники", "🔬 Рост", 8, 91.11, "USD", 99.17, -3.1, -576, -8.13, 6509, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [15, "Mips", "MIPS", "🇸🇪", "Безопасность", "🛡️ Качество", 25, 249.4, "SEK", 270.32, -0.16, -523, -7.74, 6235, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [16, "MilDef Group", "MILDEF", "🇸🇪", "Оборона IT", "🛡️ Рост", 30, 185.9, "SEK", 158.1, -0.05, 834, 17.58, 5577, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [17, "RENK Group", "RENK", "🇩🇪", "Оборона", "🛡️ Рост", 10, 48.86, "EUR", 49.15, 2.44, -31, -0.59, 5174, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"], [18, "ZenaTech", "ZENA", "🇺🇸", "Дроны / AI", "⚡ Спекулятивная", 200, 1.24, "USD", 1.27, -0.8, -53, -2.36, 2215, "—", "—", "—", "—", "—", 0, 0, "⚪ Держать"]], "subtitle": "💼 Портфель | Акции: 208,468 kr + Кэш: 20,381 kr = 228,849 kr | Вложено: 182,553 kr | Прибыль: +25,915 kr (+14.2%)", "count": 18}}, "rankings": {"OMXS30": [{"title": "✅ ТОП-10 НА ПОКУПКУ (макс. потенциал)", "headers": ["#", "Компания", "Потенциал %", "Причина"], "rows": [["1", "Evolution", "+74.2%", "⭐ #1 VALUE! Таргет 1100 = +74%! P/E ~15. Regulatory fear overdone"], ["2", "SAAB B", "+47.5%", "⭐ #1 GROWTH! +196% за год! EUR defense. Таргет 720 = +47%. MUST BUY"], ["3", "Essity B", "+20.6%", "⭐ Защитная. Industrivärden купил 262M kr. Div 3.2%. Upside +20%"], ["4", "AstraZeneca", "+20.1%", "Strong Buy 20/2. Q4 EPS beat. Pipeline strong. Guidning +двузначн. рост 2026. ЯДРО"], ["5", "NIBE Industrier B", "+14.4%", "⭐ +3.35% сегодня! Heat pumps contrarian. Упала с 120 до 36. Таргет 42 = +14%"], ["6", "Hexagon B", "+8.1%", "Digital twin + measurement. Recovery from 2024 bottom. Modest upside"], ["7", "Lifco B", "+8.0%", "⭐ Serial acquirer. ROIC >20%. Stable compounder. Upside +8%"], ["8", "Atlas Copco A", "+7.0%", "Компрессоры + вакуум. Stable compounder. Premium valuation P/E ~35"], ["9", "Boliden", "+6.7%", "Copper + zinc miner. Commodity cycle. Div 4%. Upside +7%"], ["10", "Investor B", "+6.0%", "Investment company. Owns Atlas Copco, SEB, ABB stakes. NAV discount ~5%"]]}, {"title": "🔴 ПЕРЕОЦЕНЕННЫЕ (таргет < цены) — ИЗБЕГАТЬ/ПРОДАВАТЬ", "headers": ["#", "Компания", "Потенциал %", "Причина"], "rows": [["1", "Volvo B", "-1.6%", "Div 5.5%! Trucks demand. +2.11% сегодня. Таргет достигнут → HOLD"], ["2", "Nordea Bank", "-5.6%", "Div 7.5%! НО таргет 160 < цена 170 → ПЕРЕОЦЕНЕНА. Sell/Hold"], ["3", "Ericsson B", "-5.9%", "Telecom equipment. Таргет 85 < цена 90 → ПЕРЕОЦЕНЕНА. 5G cycle mature"], ["4", "Swedbank A", "-8.2%", "Div 7%! НО таргет 280 < цена 305 → ПЕРЕОЦЕНЕНА. Sell / trim"], ["5", "Svenska Handelsbanken A", "-8.4%", "Div 6.5%! НО таргет 121 < цена 132 → ПЕРЕОЦЕНЕНА. Sell / trim"]]}, {"title": "💰 ТОП ДИВИДЕНДНЫХ (доходность >3%)", "headers": ["#", "Компания", "Дивиденд %", "Примечание"], "rows": [["1", "Nordea Bank", "7.5%", "ПЕРЕОЦЕНЕНА!"], ["2", "Swedbank A", "7.0%", "ПЕРЕОЦЕНЕНА!"], ["3", "Svenska Handelsbanken A", "6.5%", "ПЕРЕОЦЕНЕНА!"], ["4", "SEB A", "6.0%", "Upside +0.2%"], ["5", "Volvo B", "5.5%", "ПЕРЕОЦЕНЕНА!"], ["6", "Telia Company", "5.0%", "Upside +4.3%"], ["7", "Tele2 AB", "4.5%", "Upside +1.5%"], ["8", "H&M B", "4.0%", "Upside +4.2%"], ["9", "Boliden", "4.0%", "Upside +6.7%"], ["10", "Ericsson B", "3.5%", "ПЕРЕОЦЕНЕНА!"], ["11", "Skanska B", "3.5%", "Upside +5.0%"], ["12", "Essity B", "3.2%", "Upside +20.6%"], ["13", "SKF B", "3.0%", "Upside +3.6%"], ["14", "Industrivärden C", "3.0%", "Upside +0.6%"]]}], "Nasdaq 100": [{"title": "✅ ТОП-15 НА ПОКУПКУ (макс. потенциал)", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "The Trade Desk", "TTD", "+25.0%", "⚠️ CRASH -11.41%! Digital ads. Earnings miss"], ["2", "Super Micro", "SMCI", "+22.2%", "AI servers. Accounting concerns. HIGH RISK"], ["3", "Warner Bros Discovery", "WBD", "+20.0%", "Streaming + studios. Turnaround needed"], ["4", "NVIDIA", "NVDA", "+20.0%", "⭐ AI chip monopoly. H200/B200. НИЖЕ SMA200 = BUY opportunity!"], ["5", "Snowflake", "SNOW", "+19.3%", "⚠️ CRASH -11.41%! Cloud data warehouse"], ["6", "Micron Technology", "MU", "+18.2%", "⭐ HBM4 for AI! +3% surge. Memory super-cycle"], ["7", "Marvell Technology", "MRVL", "+18.2%", "Custom AI chips. Amazon/Google. Volatile"], ["8", "PayPal", "PYPL", "+17.6%", "Digital payments turnaround. New CEO momentum"], ["9", "Datadog", "DDOG", "+17.2%", "⭐ Observability + AI monitoring. +17% upside"], ["10", "AstraZeneca ADR", "AZN", "+17.1%", "⭐ Same as OMXS30 #1. Strong Buy. Pipeline strong"], ["11", "MongoDB", "MDB", "+15.4%", "NoSQL database. AI workloads. Volatile"], ["12", "ON Semiconductor", "ON", "+15.4%", "EV/industrial power chips. Cyclical"], ["13", "Dexcom", "DXCM", "+15.4%", "CGM diabetes monitoring. Recovery from 2024 dip"], ["14", "Broadcom", "AVGO", "+14.3%", "Custom AI ASIC + VMware. Volatile but strong fundamentals"], ["15", "Arista Networks", "ANET", "+14.3%", "Data center switching. AI demand driver"]]}, {"title": "🔴 CRASHES (падение >3% за день)", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "The Trade Desk", "TTD", "-11.41%", "⚠️ CRASH -11.41%! Digital ads. Earnings miss"], ["2", "Snowflake", "SNOW", "-11.41%", "⚠️ CRASH -11.41%! Cloud data warehouse"], ["3", "Cisco Systems", "CSCO", "-9.69%", "⚠️ CRASH -9.69%! Слабый прогноз. Div 3% удерживает"], ["4", "Intel", "INTC", "-7.45%", "⚠️ CRASH -7.45%! Foundry struggles. ПЕРЕОЦЕНЕНА. AVOID"]]}, {"title": "⚠️ ПЕРЕОЦЕНЕННЫЕ (таргет < цены)", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Tesla", "TSLA", "-23.0%", "Robotaxi + FSD + Energy. ПЕРЕОЦЕНЕНА! Таргет 350 < цена 454"], ["2", "AMD", "AMD", "-14.5%", "MI300X AI chip. ПЕРЕОЦЕНЕНА! Таргет 180 < 210"], ["3", "Intel", "INTC", "-13.6%", "⚠️ CRASH -7.45%! Foundry struggles. ПЕРЕОЦЕНЕНА. AVOID"], ["4", "Palantir", "PLTR", "-21.9%", "⚠️ P/S ~70! BUBBLE valuation. ПЕРЕОЦЕНЕНА. AVOID"], ["5", "Moderna", "MRNA", "-14.3%", "mRNA. Revenue declining. ПЕРЕОЦЕНЕНА. AVOID"]]}, {"title": "💰 ТОП ДИВИДЕНДНЫХ (>2%)", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Kraft Heinz", "KHC", "4.5%", "Food. Div 4.5%. Deep value. Warren Buffett"], ["2", "Gilead Sciences", "GILD", "3.5%", "⭐ HIV + liver. Div 3.5%. Defensive biotech"], ["3", "Exelon", "EXC", "3.5%", "Utility. Div 3.5%. Defensive"], ["4", "PepsiCo", "PEP", "3.2%", "Defensive. Div 3.2%. Frito-Lay + Gatorade"], ["5", "Cisco Systems", "CSCO", "3.0%", "⚠️ CRASH -9.69%! Слабый прогноз. Div 3% удерживает"], ["6", "PACCAR", "PCAR", "3.0%", "Kenworth/Peterbilt trucks. Div 3%"], ["7", "Sirius XM", "SIRI", "3.0%", "Satellite radio. Div 3%. Warren Buffett cut stake"], ["8", "Texas Instruments", "TXN", "2.5%", "Analog chips king. Cyclical bottom. Div 2.5%"], ["9", "Mondelez", "MDLZ", "2.5%", "Oreo, Cadbury. Global snacks. Defensive"], ["10", "Starbucks", "SBUX", "2.3%", "Coffee #1. New CEO turnaround. Div 2.3%"], ["11", "AstraZeneca ADR", "AZN", "2.1%", "⭐ Same as OMXS30 #1. Strong Buy. Pipeline strong"], ["12", "ADP", "ADP", "2.0%", "Payroll #1. 60 million workers. Stable"], ["13", "Baker Hughes", "BKR", "2.0%", "Energy services. LNG + clean tech"], ["14", "Honeywell", "HON", "2.0%", "Automation + aerospace. Stable diversified"]]}], "OMXSPI": [{"title": "✅ ТОП-15 ПОТЕНЦИАЛ", "headers": ["#", "Компания", "Сегмент", "Значение", "Комментарий"], "rows": [["1", "Evolution", "Large", "+74.2%", "⭐ Таргет 1100! +74% upside! P/E ~15"], ["2", "SAAB B", "Large", "+47.5%", "⭐ #1! EUR defense. +196% за год. +47% upside"], ["3", "Sdiptech B", "Mid", "+43.8%", "⭐ #1 growth mid! Q4 organic +25%. +44% upside!"], ["4", "Hansa Biopharma", "Small", "+33.4%", "Imlifidase transplant drug. +33% upside"], ["5", "OX2", "Small", "+29.4%", "Wind farm development. Green energy"], ["6", "Yubico", "Small", "+23.1%", "⚠️ -16%! But YubiKey auth niche. Speculative buy"], ["7", "BioGaia B", "Mid", "+21.5%", "Q4 organic +32%! Лучший квартал. -6% = BUY!"], ["8", "Fortnox", "Mid", "+21.2%", "Swedish small biz accounting. Monopoly"], ["9", "MilDef Group", "Mid", "+21.2%", "⭐ +5.57%! Rugged IT defense. +21%"], ["10", "Betsson B", "Mid", "+21.1%", "Div 6% + P/E ~10. Deep value"], ["11", "Thule Group", "Mid", "+21.1%", "Q4 gross margin 46%! #1 quality mid"], ["12", "Essity B", "Large", "+20.6%", "Industrivärden купил 262M. +20% upside"], ["13", "AstraZeneca", "Large", "+20.1%", "Strong Buy 20/2. Q4 EPS beat. #1 защитная"], ["14", "Vestum", "Small", "+20.0%", "⭐ +16.28%! Serial acquirer turnaround"], ["15", "Plejd", "Small", "+20.0%", "Smart lighting. Nordic niche"]]}, {"title": "🔥 ТОП-10 РОСТ ЗА ДЕНЬ", "headers": ["#", "Компания", "Сегмент", "Значение", "Комментарий"], "rows": [["1", "Stille", "Small", "+21.38%", "⭐ +21.38%! Surgical instruments. ATH"], ["2", "Embracer Group B", "Small", "+19.49%", "⭐ +19.49%! Turnaround! Q3 restructuring works"], ["3", "Vestum", "Small", "+16.28%", "⭐ +16.28%! Serial acquirer turnaround"], ["4", "Hansa Biopharma", "Small", "+6.35%", "Imlifidase transplant drug. +33% upside"], ["5", "MilDef Group", "Mid", "+5.57%", "⭐ +5.57%! Rugged IT defense. +21%"], ["6", "NIBE B", "Large", "+3.35%", "⭐ +3.35%! Contrarian. С 120→36. +14%"], ["7", "Scandi Standard", "Mid", "+2.31%", "Nordic chicken. Improving margins"], ["8", "Nederman", "Small", "+2.24%", "Air filtration. Industrial clean air"], ["9", "Volvo B", "Large", "+2.11%", "Div 5.5%! Trucks. Таргет достигнут"], ["10", "SAAB B", "Large", "+2.09%", "⭐ #1! EUR defense. +196% за год. +47% upside"]]}, {"title": "💰 ТОП ДИВИДЕНДНЫХ (≥3%)", "headers": ["#", "Компания", "Сегмент", "Значение", "Комментарий"], "rows": [["1", "Nordea Bank", "Large", "7.5%", "Div 7.5%! НО переоценена (таргет 160)"], ["2", "Swedbank A", "Large", "7.0%", "Div 7%! НО переоценена"], ["3", "Handelsbanken A", "Large", "6.5%", "Div 6.5%! НО переоценена"], ["4", "SEB A", "Large", "6.0%", "Div 6%. Fair value"], ["5", "Betsson B", "Mid", "6.0%", "Div 6% + P/E ~10. Deep value"], ["6", "Volvo B", "Large", "5.5%", "Div 5.5%! Trucks. Таргет достигнут"], ["7", "Telia", "Large", "5.0%", "Div 5%. Nordic telecom"], ["8", "Coor Service", "Mid", "5.0%", "Div 5%. Recurring contracts"], ["9", "NCC B", "Mid", "5.0%", "Construction. Div 5%. Housing"], ["10", "Cloetta", "Mid", "4.2%", "SEB Köp. Div 4.2%. Тихий compounder"], ["11", "Diös Fastigheter", "Mid", "4.2%", "Div 4.2%. Handelsbanken Köp (höjd 73)"], ["12", "H&M B", "Large", "4.0%", "Fast fashion turnaround"], ["13", "Boliden", "Large", "4.0%", "Copper + zinc. Div 4%"], ["14", "Solid Försäkring", "Small", "4.0%", "Niche insurance. Div 4%"], ["15", "Ericsson B", "Large", "3.5%", "Переоценена. 5G cycle mature"], ["16", "Skanska B", "Large", "3.5%", "Housing recovery play"], ["17", "Scandi Standard", "Mid", "3.5%", "Nordic chicken. Improving margins"], ["18", "Nyfosa", "Mid", "3.5%", "Commercial RE. Div 3.5%"], ["19", "Arjo B", "Small", "3.5%", "Patient handling. Div 3.5%"], ["20", "Essity B", "Large", "3.2%", "Industrivärden купил 262M. +20% upside"], ["21", "Industrivärden C", "Large", "3.0%", "Owns Volvo,SHB,Sandvik,Essity"], ["22", "Bravida", "Mid", "3.0%", "Installation services. Div 3%"], ["23", "Hexpol B", "Mid", "3.0%", "Polymer compounding. Div 3%"], ["24", "Husqvarna B", "Mid", "3.0%", "Robotmowers. Div 3%"], ["25", "Castellum", "Mid", "3.0%", "Nordic commercial RE. Recovery"], ["26", "Bulten", "Small", "3.0%", "Fasteners for auto. Div 3%"]]}, {"title": "🔴 CRASHES ЗА ДЕНЬ (<-5%)", "headers": ["#", "Компания", "Сегмент", "Значение", "Комментарий"], "rows": [["1", "Camurus", "Small", "-23.06%", "⚠️ -23%! Q4 miss. Но +20% upside если восст."], ["2", "Yubico", "Small", "-16.1%", "⚠️ -16%! But YubiKey auth niche. Speculative buy"], ["3", "BioGaia B", "Mid", "-6.13%", "Q4 organic +32%! Лучший квартал. -6% = BUY!"]]}], "S&P 500": [{"title": "✅ ТОП-20 ПОТЕНЦИАЛ", "headers": ["#", "Компания", "Сектор", "Значение", "Комментарий"], "rows": [["1", "Oracle", "Information Tech", "+29.0%", "⭐ Cloud DB+AI. -3.2% dip. Target 200 = +29%!"], ["2", "Merck", "Health Care", "+22.4%", "Keytruda immunotherapy. Div 3%. Value"], ["3", "Nike", "Consumer Discr.", "+21.4%", "⭐ Deep value. New CEO. -50% от ATH. +21%"], ["4", "NVIDIA", "Information Tech", "+20.0%", "⭐ AI GPU monopoly. Below SMA200! BUY on dip"], ["5", "Schlumberger", "Energy", "+19.0%", "Oilfield services #1. Digital"], ["6", "Micron", "Information Tech", "+18.2%", "⭐ HBM4 for AI! +3% surge. Memory supercycle"], ["7", "Marvell", "Information Tech", "+18.2%", "Custom AI silicon. Volatile"], ["8", "Freeport-McMoRan", "Materials", "+15.6%", "⭐ Copper! EV+AI demand. Cyclical"], ["9", "ON Semiconductor", "Information Tech", "+15.4%", "Power semis. EV/industrial. Cyclical"], ["10", "Pfizer", "Health Care", "+15.4%", "⭐ Div 6%! Deep value. Post-COVID recovery"], ["11", "ConocoPhillips", "Energy", "+15.0%", "E&P pure play. Marathon Oil acquired"], ["12", "Crown Castle", "Real Estate", "+15.0%", "Cell tower. Div 5.5%"], ["13", "Newmont", "Materials", "+14.6%", "Gold miner #1. Inflation hedge"], ["14", "Broadcom", "Information Tech", "+14.3%", "Custom AI ASIC+VMware. Volatile"], ["15", "General Electric", "Industrials", "+14.3%", "Aerospace engines. AI maintenance"], ["16", "Medtronic", "Health Care", "+13.6%", "MedDevices. Div 3.2%. Turnaround"], ["17", "Walt Disney", "Comm. Services", "+13.6%", "Streaming+Parks+ESPN. Recovery"], ["18", "Comcast", "Comm. Services", "+13.5%", "Broadband+NBCUniversal+Peacock. Div 3%"], ["19", "Amazon", "Consumer Discr.", "+13.5%", "AWS #1 cloud. Ads+retail. Slight weakness"], ["20", "Salesforce", "Information Tech", "+13.1%", "CRM #1. Agentforce AI. Recovery +3.66%"]]}, {"title": "💰 ТОП ДИВИДЕНДНЫХ (≥3%)", "headers": ["#", "Компания", "Сектор", "Значение", "Комментарий"], "rows": [["1", "Altria", "Consumer Staples", "7.5%", "⭐ Div 7.5%! Tobacco. NJOY vapes"], ["2", "Verizon", "Comm. Services", "6.2%", "⭐ Div 6.2%! Telecom. Defensive income"], ["3", "Pfizer", "Health Care", "6.0%", "⭐ Div 6%! Deep value. Post-COVID recovery"], ["4", "Crown Castle", "Real Estate", "5.5%", "Cell tower. Div 5.5%"], ["5", "AT&T", "Comm. Services", "5.0%", "Div 5%. Fiber+5G. Turnaround"], ["6", "Kraft Heinz", "Consumer Staples", "4.5%", "Food. Div 4.5%. Deep value. Buffett"], ["7", "Philip Morris", "Consumer Staples", "4.2%", "IQOS+ZYN. Div 4.2%. Smoke-free pivot"], ["8", "Chevron", "Energy", "4.0%", "Oil #2. Hess acquisition. Div 4%"], ["9", "CME Group", "Financials", "3.8%", "Derivatives exchange. Div 3.8%"], ["10", "Duke Energy", "Utilities", "3.8%", "Utility. Data center demand. Div 3.8%"], ["11", "AbbVie", "Health Care", "3.5%", "⭐ Humira→Skyrizi/Rinvoq. Div 3.5%. +13%"], ["12", "Gilead", "Health Care", "3.5%", "HIV+liver. Div 3.5%. Defensive"], ["13", "General Mills", "Consumer Staples", "3.5%", "Cereal+snacks. Div 3.5%"], ["14", "Southern Company", "Utilities", "3.5%", "Utility. Nuclear. Div 3.5%"], ["15", "Exelon", "Utilities", "3.5%", "Utility. Div 3.5%. Defensive"], ["16", "Johnson & Johnson", "Health Care", "3.2%", "MedDevices+Pharma. Div 3.2%. Defensive"], ["17", "Amgen", "Health Care", "3.2%", "Obesity pipeline. Div 3.2%"], ["18", "Medtronic", "Health Care", "3.2%", "MedDevices. Div 3.2%. Turnaround"], ["19", "PepsiCo", "Consumer Staples", "3.2%", "Snacks+drinks. Div 3.2%"], ["20", "ExxonMobil", "Energy", "3.2%", "Oil #1. Guyana+Permian. Div 3.2%"]]}, {"title": "🔴 CRASHES (<-3%)", "headers": ["#", "Компания", "Сектор", "Значение", "Комментарий"], "rows": [["1", "Cisco", "Information Tech", "-9.69%", "⚠️ CRASH -9.69%! Weak forecast. Div 3%"], ["2", "Intel", "Information Tech", "-7.45%", "⚠️ CRASH -7.45%! Foundry crisis. AVOID"], ["3", "Oracle", "Information Tech", "-3.2%", "⭐ Cloud DB+AI. -3.2% dip. Target 200 = +29%!"]]}, {"title": "⚠️ ПЕРЕОЦЕНЕННЫЕ", "headers": ["#", "Компания", "Сектор", "Значение", "Комментарий"], "rows": [["1", "Tesla", "Consumer Discr.", "-23.0%", "FSD+Robotaxi. ПЕРЕОЦЕНЕНА! Target < price"], ["2", "AMD", "Information Tech", "-14.5%", "MI300X. ПЕРЕОЦЕНЕНА. Target 180 < 210"], ["3", "Palantir", "Information Tech", "-21.9%", "⚠️ P/S ~70! BUBBLE. ПЕРЕОЦЕНЕНА. AVOID"], ["4", "Intel", "Information Tech", "-13.6%", "⚠️ CRASH -7.45%! Foundry crisis. AVOID"], ["5", "Moderna", "Health Care", "-14.3%", "mRNA. Revenue declining. AVOID"]]}], "DAX 40": [{"title": "✅ ТОП-10 ПОТЕНЦИАЛ", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Porsche AG", "P911", "+21.0%", "Luxury sports cars. 911+Taycan. -decline"], ["2", "RWE", "RWE", "+20.7%", "⚠️ -4.1%! Renewable utility. EU emissions reform"], ["3", "Zalando", "ZAL", "+18.8%", "Fashion e-comm. About.You merger"], ["4", "Puma", "PUM", "+18.2%", "Sportswear. Recovery. Adidas shadow"], ["5", "Heidelberg Materials", "HEI", "+16.1%", "⚠️ CRASH -11.57%! EU emissions reform hit"], ["6", "Siemens Energy", "ENR", "+15.4%", "⭐⭐ +7.8%! Net profit 3x! AI gas turbines!"], ["7", "Continental", "CON", "+15.4%", "Auto parts. EV transition. Div 3%. Cyclical"], ["8", "Infineon", "IFX", "+15.2%", "Auto/power semis. Cyclical recovery. +15%"], ["9", "Volkswagen", "VOW3", "+15.0%", "Div 8%! НО EV transition pain. China decline"], ["10", "Porsche SE", "PAH3", "+14.3%", "VW holding. Div 5%. Discount to NAV"]]}, {"title": "💰 ДИВИДЕНДНЫЕ (≥3%)", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Volkswagen", "VOW3", "8.0%", "Div 8%! НО EV transition pain. China decline"], ["2", "Mercedes-Benz", "MBG", "7.5%", "⚠️ -4.1%! Profits decline. Div 7.5% НО risk!"], ["3", "BMW", "BMW", "5.5%", "Div 5.5%. EV transition. China weakness"], ["4", "BASF", "BAS", "5.0%", "Chemicals #1 EU. Div 5%. Restructuring"], ["5", "Porsche SE", "PAH3", "5.0%", "VW holding. Div 5%. Discount to NAV"], ["6", "Allianz", "ALV", "4.5%", "Insurance #1 EU. Div 4.5%. Stable"], ["7", "E.ON", "EOAN", "4.5%", "Energy utility. Div 4.5%. Green transition"], ["8", "Deutsche Post/DHL", "DHL", "4.0%", "⚠️ -5.07%! Logistics slowdown. Div 4%"], ["9", "Deutsche Telekom", "DTE", "3.5%", "⭐ +6.19% surge! T-Mobile US drives value"], ["10", "Hannover Rück", "HNR1", "3.5%", "+2.87%. Reinsurance #2. Div 3.5%"], ["11", "Heidelberg Materials", "HEI", "3.5%", "⚠️ CRASH -11.57%! EU emissions reform hit"], ["12", "Commerzbank", "CBK", "3.5%", "UniCredit takeover target? Div 3.5%"], ["13", "Munich Re", "MUV2", "3.0%", "Reinsurance #1. Div 3%. Climate risk pricing"], ["14", "Deutsche Bank", "DBK", "3.0%", "Investment bank. Turnaround. Div 3%"], ["15", "RWE", "RWE", "3.0%", "⚠️ -4.1%! Renewable utility. EU emissions reform"], ["16", "Vonovia", "VNA", "3.0%", "Residential REIT. Rate cut play. Div 3%"], ["17", "Brenntag", "BNR", "3.0%", "Chemical distribution. Cyclical"], ["18", "Continental", "CON", "3.0%", "Auto parts. EV transition. Div 3%. Cyclical"]]}, {"title": "🔴 CRASHES (<-3%)", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Heidelberg Materials", "HEI", "-11.57%", "⚠️ CRASH -11.57%! EU emissions reform hit"], ["2", "Scout24", "G24", "-5.56%", "-5.56%. ImmoScout. German RE platform"], ["3", "SAP", "SAP", "-5.4%", "⚠️ -5.4%! AI displacement fears. НО таргет 300 = +12%"], ["4", "Deutsche Post/DHL", "DHL", "-5.07%", "⚠️ -5.07%! Logistics slowdown. Div 4%"], ["5", "Mercedes-Benz", "MBG", "-4.1%", "⚠️ -4.1%! Profits decline. Div 7.5% НО risk!"], ["6", "RWE", "RWE", "-4.1%", "⚠️ -4.1%! Renewable utility. EU emissions reform"]]}], "CAC 40": [{"title": "✅ ТОП-10 ПОТЕНЦИАЛ", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Worldline", "WLN", "+33.3%", "⚠️ Payments. Troubled. Deep value? +33%"], ["2", "Vivendi", "VIV", "+25.0%", "Canal+/Havas spun off. Value unlock"], ["3", "Stellantis", "STLAM", "+25.0%", "Div 8%! НО struggling. Fiat+Peugeot+Chrysler"], ["4", "Kering", "KER", "+18.2%", "⭐ Gucci turnaround. -1.5%. Deep value. +18%"], ["5", "Unibail-Rodamco", "URW", "+18.1%", "Shopping centers. Rate cut play. Div 5%"], ["6", "Teleperformance", "TEP", "+17.6%", "Customer service. AI disruption risk. +18%"], ["7", "Eurofins Scientific", "ERF", "+16.0%", "Food/pharma testing. Steady"], ["8", "Edenred", "EDEN", "+15.2%", "Meal vouchers. Fintech. +15%"], ["9", "Dassault Systèmes", "DSY", "+14.3%", "3D design software. Industrial metaverse"], ["10", "Pernod Ricard", "RI", "+14.3%", "⭐ Spirits. -1.2%. China tariffs fear. +14%"]]}, {"title": "💰 ДИВИДЕНДНЫЕ (≥3%)", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Stellantis", "STLAM", "8.0%", "Div 8%! НО struggling. Fiat+Peugeot+Chrysler"], ["2", "Orange", "ORA", "7.0%", "⭐ Telecom. Div 7%! Highest in CAC"], ["3", "Société Générale", "GLE", "6.5%", "Banking. Div 6.5%! Turnaround"], ["4", "BNP Paribas", "BNP", "6.0%", "Bank #1 EU. Div 6%. Investment banking"], ["5", "Crédit Agricole", "ACA", "6.0%", "Retail banking. Div 6%. +13%"], ["6", "AXA", "CS", "5.5%", "Insurance #2 EU. Div 5.5%. Undervalued"], ["7", "Engie", "ENGI", "5.5%", "Energy utility. Div 5.5%. Nuclear+gas"], ["8", "TotalEnergies", "TTE", "5.0%", "Oil #1 EU. Div 5%. LNG+renewables pivot"], ["9", "Bouygues", "EN", "5.0%", "Telecom+construction. Div 5%"], ["10", "Renault", "RNO", "5.0%", "Auto turnaround. Div 5%. EV push"], ["11", "Unibail-Rodamco", "URW", "5.0%", "Shopping centers. Rate cut play. Div 5%"], ["12", "Sanofi", "SAN", "3.5%", "Dupixent blockbuster. Div 3.5%. +13%"], ["13", "Vinci", "DG", "3.5%", "Infrastructure+airports+construction. Div 3.5%"], ["14", "Danone", "BN", "3.5%", "Yogurt+water+baby food. Div 3.5%"], ["15", "Michelin", "ML", "3.5%", "Tires #1. Div 3.5%. Steady"], ["16", "Veolia", "VIE", "3.5%", "Water+waste #1 global. Div 3.5%"], ["17", "Pernod Ricard", "RI", "3.0%", "⭐ Spirits. -1.2%. China tariffs fear. +14%"], ["18", "Kering", "KER", "3.0%", "⭐ Gucci turnaround. -1.5%. Deep value. +18%"], ["19", "Arkema", "AKE", "3.0%", "Specialty chemicals. Cyclical recovery"], ["20", "Teleperformance", "TEP", "3.0%", "Customer service. AI disruption risk. +18%"]]}], "FTSE MIB": [{"title": "✅ ТОП-10 ПОТЕНЦИАЛ", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Telecom Italia", "TIT", "+26.7%", "Telecom. NetCo sold. Turnaround? +27%"], ["2", "Stellantis", "STLAM", "+25.0%", "Div 8%! НО struggling. Fiat+Alfa+Maserati"], ["3", "Saipem", "SPM", "+21.7%", "⭐ Offshore engineering. Turnaround. +22%"], ["4", "Iveco Group", "IVG", "+21.4%", "⭐ Trucks+defense vehicles. +21% upside"], ["5", "Fincantieri", "FCT", "+21.2%", "⭐ +2.87%! Naval defense. Submarines+frigates"], ["6", "Nexi", "NEXI", "+20.7%", "⭐ Payments IT #1. Deep value. +21%"], ["7", "ERG", "ERG", "+20.0%", "Wind+solar. Green energy. Div 3%"], ["8", "Amplifon", "AMP", "+18.2%", "Hearing aids #1. Demographics. +18%"], ["9", "STMicroelectronics", "STMF", "+16.7%", "Auto+industrial chips. Cyclical recovery. +17%"], ["10", "DiaSorin", "DIA", "+15.8%", "Molecular diagnostics. Niche"]]}, {"title": "💰 ДИВИДЕНДНЫЕ (≥3%)", "headers": ["#", "Компания", "Тикер", "Значение", "Комментарий"], "rows": [["1", "Stellantis", "STLAM", "8.0%", "Div 8%! НО struggling. Fiat+Alfa+Maserati"], ["2", "Intesa Sanpaolo", "ISP", "7.0%", "⭐ Div 7%! Bank #2 IT. Wealth management"], ["3", "Eni", "ENI", "6.5%", "⭐ Oil+gas. Div 6.5%. LNG. Transition"], ["4", "Azimut", "AZM", "6.0%", "⭐ Asset management. Div 6%! Fintech"], ["5", "UniCredit", "UCG", "5.5%", "⭐ Bank #1 IT. Div 5.5%. Commerzbank bid"], ["6", "Enel", "ENEL", "5.5%", "⭐ Utility. Div 5.5%. Renewables. Global"], ["7", "Banco BPM", "BAMI", "5.5%", "Regional bank. Div 5.5%. UniCredit bid target"], ["8", "Snam", "SRG", "5.5%", "Gas pipelines. Div 5.5%. Hydrogen ready"], ["9", "Generali", "G", "5.0%", "Insurance #1 IT. Div 5%. Acquisitions"], ["10", "Mediobanca", "MB", "5.0%", "Investment bank IT. Div 5%"], ["11", "BPER Banca", "BPE", "5.0%", "Regional bank. Div 5%. Consolidation"], ["12", "Inwit", "INW", "5.0%", "Tower company. Div 5%. 5G/AI demand"], ["13", "Poste Italiane", "PST", "5.0%", "Post+insurance+payments. Div 5%. Stable"], ["14", "A2A", "A2A", "4.5%", "Multi-utility. Div 4.5%. Lombardy"], ["15", "Italgas", "IG", "4.5%", "Gas distribution. Div 4.5%. Regulated"], ["16", "MPS (Banca Monte Paschi)", "BMPS", "4.0%", "⭐ +1.5%! Turnaround complete. Div 4%"], ["17", "Terna", "TRN", "4.0%", "Electricity grid. Div 4%. Regulated. Safe"], ["18", "Banca Popolare Sondrio", "BPSO", "4.0%", "Regional bank. Div 4%"], ["19", "Finecobank", "FBK", "3.5%", "Digital bank. Div 3.5%. Growth+income"], ["20", "Pirelli", "PIRC", "3.5%", "Premium tires. Div 3.5%. China risk"], ["21", "Hera", "HER", "3.5%", "Multi-utility Emilia. Div 3.5%"], ["22", "Tenaris", "TEN", "3.0%", "Oil&gas pipes. Energy capex. Div 3%"], ["23", "ERG", "ERG", "3.0%", "Wind+solar. Green energy. Div 3%"]]}], "OBX 25": [{"title": "✅ ТОП-10 ПОТЕНЦИАЛ", "headers": ["#", "Компания", "Тикер", "Потенциал %", "Комментарий"], "rows": [["1", "Nel ASA", "NEL", "+42.9%", "⚠️ Hydrogen. Speculative. Loss-making. +43% IF recovery"], ["2", "Autostore", "AUTO", "+37.5%", "⭐ Warehouse robotics. -3.5%. Deep value. +38%!"], ["3", "Aker Solutions", "AKSO", "+18.4%", "Subsea+renewables engineering. +18%"], ["4", "Tomra Systems", "TOM", "+17.9%", "⭐ Reverse vending. Recycling. +18% upside"], ["5", "Kongsberg Gruppen", "KOG", "+16.7%", "⭐ Defense + maritime. NASAMS. +17%!"], ["6", "Aker BP", "AKRBP", "+15.6%", "⭐ Div 10%! E&P #2 Norway. High yield king"], ["7", "Austevoll Seafood", "AUSS", "+15.0%", "Pelagic fish + salmon ownership. Div 4.5%"], ["8", "Norsk Hydro", "NHY", "+13.3%", "Aluminium. Div 5%. Green metal. +13%"], ["9", "Wallenius Wilhelmsen", "WAWI", "+12.0%", "Car carrier shipping. Div 5%. +12%"], ["10", "Frontline", "FRO", "+11.1%", "Crude tankers. Div 8%. Volatile"]]}, {"title": "💰 ДИВИДЕНДНЫЕ ЗВЁЗДЫ (≥5%)", "headers": ["#", "Компания", "Тикер", "Дивиденд %", "Комментарий"], "rows": [["1", "BW LPG", "BWLPG", "12.0%", "⭐⭐ Div 12%! LPG tankers. #1 dividend"], ["2", "Aker BP", "AKRBP", "10.0%", "⭐ Div 10%! E&P #2 Norway. High yield king"], ["3", "Hafnia", "HAFNI", "10.0%", "⭐ Product tankers. Div 10%! Strong cash flow"], ["4", "Vår Energi", "VAR", "9.0%", "⭐ Div 9%! E&P. Eni subsidiary. Stable production"], ["5", "Equinor", "EQNR", "8.0%", "⭐ Oil #1 Norway. Div 8%! Johan Sverdrup. +10%"], ["6", "Frontline", "FRO", "8.0%", "Crude tankers. Div 8%. Volatile"], ["7", "Telenor", "TEL", "6.5%", "Nordic telecom. Div 6.5%. Asia exit"], ["8", "DNB Bank", "DNB", "5.5%", "Bank #1 Norway. Div 5.5%. Mortgage king"], ["9", "Gjensidige", "GJF", "5.5%", "Insurance #1 Norway. Div 5.5%. Stable"], ["10", "Norsk Hydro", "NHY", "5.0%", "Aluminium. Div 5%. Green metal. +13%"], ["11", "Wallenius Wilhelmsen", "WAWI", "5.0%", "Car carrier shipping. Div 5%. +12%"]]}], "💼 Портфель 2.0": [{"title": "📋 ПЛАН ДЕЙСТВИЙ", "headers": ["Действие", "Компании", "Сумма", "Причина"], "rows": [["🔴 ПРОДАТЬ (7)", "Loomis, Hacksaw, Tele2 B, NCC B, Scandi Standard, Solid Försäkring, Lemonade", "~46 062 kr", "Слабые/дублирующие, без роста"], ["🟠 СОКРАТИТЬ (4)", "Rheinmetall 3→1, AstraZeneca 16→12, Nordea 150→120, Dellia 52→40", "~50 600 kr", "Перевзвешенные позиции"], ["🟢 ДОКУПИТЬ (6)", "TSM +1, AVGO +2, NVDA +3, MSFT +2, NOVO B +10, PLTR +3", "~45 000 kr", "AI, чипы, рост"], ["🔵 КУПИТЬ (9)", "Realty Income, Amazon, J&J, P&G, NextEra, Coca-Cola, Toyota, Unilever, Prologis", "~77 000 kr", "Недвижимость, Утилиты, Ритейл, Consumer"]]}, {"title": "📊 ПО ДЕЙСТВИЮ", "headers": ["Действие", "Позиций", "Сейчас", "Цель"], "rows": [["🔵 Купить", "9", "2,348 kr", "75,907 kr"], ["🟢 Докупить", "6", "41,378 kr", "80,968 kr"], ["⚪ Держать", "13", "120,046 kr", "104,584 kr"], ["🟠 Сократить", "4", "131,502 kr", "59,039 kr"], ["🔴 Продать", "7", "42,094 kr", "0 kr"]]}, {"title": "🎯 ЦЕЛЕВАЯ АЛЛОКАЦИЯ", "headers": ["#", "Компания", "Действие", "Сейчас", "Цель", "Цель %", "Δ"], "rows": [["1", "AstraZeneca", "🟠 Сократить", "29,920 kr", "16,868 kr", "5.0%", "-13,052 kr"], ["2", "Nordea Bank", "🟠 Сократить", "26,640 kr", "16,868 kr", "5.0%", "-9,772 kr"], ["3", "NVIDIA", "🟢 Докупить", "8,481 kr", "16,868 kr", "5.0%", "+8,387 kr"], ["4", "Microsoft", "🟢 Докупить", "7,211 kr", "16,868 kr", "5.0%", "+9,657 kr"], ["5", "Broadcom", "🟢 Докупить", "9,028 kr", "15,182 kr", "4.5%", "+6,154 kr"], ["6", "Rheinmetall", "🟠 Сократить", "54,456 kr", "13,495 kr", "4.0%", "-40,961 kr"], ["7", "Taiwan Semiconductor", "🟢 Докупить", "9,806 kr", "13,495 kr", "4.0%", "+3,689 kr"], ["8", "Dellia Group", "🟠 Сократить", "20,486 kr", "11,808 kr", "3.5%", "-8,678 kr"], ["9", "KLA Corp", "⚪ Держать", "13,356 kr", "11,808 kr", "3.5%", "-1,548 kr"], ["10", "ASML Holding", "⚪ Держать", "13,128 kr", "11,808 kr", "3.5%", "-1,320 kr"], ["11", "Novo Nordisk B", "🟢 Докупить", "4,409 kr", "11,808 kr", "3.5%", "+7,399 kr"], ["12", "Amazon", "🔵 Купить", "—", "11,808 kr", "3.5%", "+11,808 kr"], ["13", "MilDef Group", "⚪ Держать", "14,250 kr", "10,121 kr", "3.0%", "-4,129 kr"], ["14", "Swedish Orphan Biovitrum", "⚪ Держать", "12,735 kr", "10,121 kr", "3.0%", "-2,614 kr"], ["15", "Realty Income", "🔵 Купить", "2,348 kr", "10,121 kr", "3.0%", "+7,773 kr"], ["16", "Procter & Gamble", "🔵 Купить", "—", "10,121 kr", "3.0%", "+10,121 kr"], ["17", "Johnson & Johnson", "🔵 Купить", "—", "10,121 kr", "3.0%", "+10,121 kr"], ["18", "Skanska B", "⚪ Держать", "10,792 kr", "8,434 kr", "2.5%", "-2,358 kr"], ["19", "CellaVision", "⚪ Держать", "10,598 kr", "8,434 kr", "2.5%", "-2,164 kr"], ["20", "Swedbank A", "⚪ Держать", "10,557 kr", "8,434 kr", "2.5%", "-2,123 kr"], ["21", "EQT", "⚪ Держать", "10,633 kr", "8,434 kr", "2.5%", "-2,199 kr"], ["22", "Atlas Copco A", "⚪ Держать", "7,766 kr", "8,434 kr", "2.5%", "+668 kr"], ["23", "Investor AB", "⚪ Держать", "7,349 kr", "8,434 kr", "2.5%", "+1,085 kr"], ["24", "NextEra Energy", "🔵 Купить", "—", "8,434 kr", "2.5%", "+8,434 kr"], ["25", "Palantir Technologies", "🟢 Докупить", "2,443 kr", "6,747 kr", "2.0%", "+4,304 kr"], ["26", "Prologis", "🔵 Купить", "—", "6,747 kr", "2.0%", "+6,747 kr"], ["27", "Toyota", "🔵 Купить", "—", "6,747 kr", "2.0%", "+6,747 kr"], ["28", "Coca-Cola", "🔵 Купить", "—", "6,747 kr", "2.0%", "+6,747 kr"], ["29", "Vår Energi", "⚪ Держать", "3,258 kr", "5,061 kr", "1.5%", "+1,803 kr"], ["30", "Unilever", "🔵 Купить", "—", "5,061 kr", "1.5%", "+5,061 kr"], ["31", "Fincantieri", "⚪ Держать", "3,441 kr", "3,374 kr", "1.0%", "-67 kr"], ["32", "Figma", "⚪ Держать", "2,183 kr", "1,687 kr", "0.5%", "-496 kr"]]}, {"title": "✅ ТОП ПРИБЫЛЬНЫЕ", "headers": ["#", "Компания", "Прибыль", "%", "Стоимость"], "rows": [["1", "Dellia Group", "+10,193 kr", "+99.03%", "20,486 kr"], ["2", "Solid Försäkring", "+731 kr", "+16.28%", "5,220 kr"], ["3", "Nordea Bank", "+3,247 kr", "+13.88%", "26,640 kr"], ["4", "Scandi Standard", "+591 kr", "+11.55%", "5,706 kr"], ["5", "Swedish Orphan Biovitrum", "+1,229 kr", "+10.68%", "12,735 kr"], ["6", "MilDef Group", "+1,311 kr", "+10.13%", "14,250 kr"], ["7", "AstraZeneca", "+2,645 kr", "+9.7%", "29,920 kr"], ["8", "KLA Corp", "+1,150 kr", "+9.42%", "13,356 kr"], ["9", "CellaVision", "+647 kr", "+6.5%", "10,598 kr"], ["10", "Rheinmetall", "+3,282 kr", "+6.41%", "54,456 kr"], ["11", "NVIDIA", "+426 kr", "+5.29%", "8,481 kr"], ["12", "EQT", "+471 kr", "+4.64%", "10,633 kr"], ["13", "ASML Holding", "+558 kr", "+4.44%", "13,128 kr"], ["14", "Palantir Technologies", "+78 kr", "+3.31%", "2,443 kr"], ["15", "Lemonade", "+50 kr", "+2.14%", "2,372 kr"], ["16", "Vår Energi", "+61 kr", "+1.92%", "3,258 kr"], ["17", "NCC B", "+123 kr", "+1.89%", "6,618 kr"], ["18", "Taiwan Semiconductor", "+167 kr", "+1.73%", "9,806 kr"], ["19", "Figma", "+37 kr", "+1.71%", "2,183 kr"], ["20", "Hacksaw", "+79 kr", "+1.38%", "5,810 kr"], ["21", "Broadcom", "+109 kr", "+1.22%", "9,028 kr"], ["22", "Investor AB", "+75 kr", "+1.03%", "7,349 kr"], ["23", "Atlas Copco A", "+69 kr", "+0.9%", "7,766 kr"], ["24", "Swedbank A", "+78 kr", "+0.74%", "10,557 kr"]]}, {"title": "🔴 УБЫТОЧНЫЕ", "headers": ["#", "Компания", "Убыток", "%", "Стоимость"], "rows": [["1", "Fincantieri", "-187 kr", "-5.16%", "3,441 kr"], ["2", "Skanska B", "-104 kr", "-0.95%", "10,792 kr"], ["3", "Realty Income", "-103 kr", "-4.19%", "2,348 kr"], ["4", "Microsoft", "-73 kr", "-1.0%", "7,211 kr"], ["5", "Novo Nordisk B", "-70 kr", "-1.57%", "4,409 kr"], ["6", "Loomis", "-31 kr", "-0.35%", "8,796 kr"], ["7", "Tele2 B", "-17 kr", "-0.22%", "7,572 kr"]]}, {"title": "💰 ПО СТОИМОСТИ", "headers": ["#", "Компания", "Стоимость", "Доля", "Действие"], "rows": [["1", "Rheinmetall", "54,456 kr", "16.1%", "🟠 Сократить"], ["2", "AstraZeneca", "29,920 kr", "8.9%", "🟠 Сократить"], ["3", "Nordea Bank", "26,640 kr", "7.9%", "🟠 Сократить"], ["4", "Dellia Group", "20,486 kr", "6.1%", "🟠 Сократить"], ["5", "MilDef Group", "14,250 kr", "4.2%", "⚪ Держать"], ["6", "KLA Corp", "13,356 kr", "4.0%", "⚪ Держать"], ["7", "ASML Holding", "13,128 kr", "3.9%", "⚪ Держать"], ["8", "Swedish Orphan Biovitrum", "12,735 kr", "3.8%", "⚪ Держать"], ["9", "Skanska B", "10,792 kr", "3.2%", "⚪ Держать"], ["10", "EQT", "10,633 kr", "3.2%", "⚪ Держать"], ["11", "CellaVision", "10,598 kr", "3.1%", "⚪ Держать"], ["12", "Swedbank A", "10,557 kr", "3.1%", "⚪ Держать"], ["13", "Taiwan Semiconductor", "9,806 kr", "2.9%", "🟢 Докупить"], ["14", "Broadcom", "9,028 kr", "2.7%", "🟢 Докупить"], ["15", "Loomis", "8,796 kr", "2.6%", "🔴 Продать"], ["16", "NVIDIA", "8,481 kr", "2.5%", "🟢 Докупить"], ["17", "Atlas Copco A", "7,766 kr", "2.3%", "⚪ Держать"], ["18", "Tele2 B", "7,572 kr", "2.2%", "🔴 Продать"], ["19", "Investor AB", "7,349 kr", "2.2%", "⚪ Держать"], ["20", "Microsoft", "7,211 kr", "2.1%", "🟢 Докупить"], ["21", "NCC B", "6,618 kr", "2.0%", "🔴 Продать"], ["22", "Hacksaw", "5,810 kr", "1.7%", "🔴 Продать"], ["23", "Scandi Standard", "5,706 kr", "1.7%", "🔴 Продать"], ["24", "Solid Försäkring", "5,220 kr", "1.5%", "🔴 Продать"], ["25", "Novo Nordisk B", "4,409 kr", "1.3%", "🟢 Докупить"], ["26", "Fincantieri", "3,441 kr", "1.0%", "⚪ Держать"], ["27", "Vår Energi", "3,258 kr", "1.0%", "⚪ Держать"], ["28", "Palantir Technologies", "2,443 kr", "0.7%", "🟢 Докупить"], ["29", "Lemonade", "2,372 kr", "0.7%", "🔴 Продать"], ["30", "Realty Income", "2,348 kr", "0.7%", "🔵 Купить"], ["31", "Figma", "2,183 kr", "0.6%", "⚪ Держать"]]}, {"title": "📅 ДИВИДЕНДНЫЙ КАЛЕНДАРЬ 2026 (итого: 6,564 kr)", "headers": ["#", "Компания", "X-dag", "Выплата", "На акцию", "Валюта", "Кол-во", "Сумма kr", "Действие"], "rows": [["1", "AstraZeneca", "19.02.2026", "23.03.2026", "19.45", "SEK", "×16", "311.2 kr", "🟠 Сократить"], ["2", "Microsoft", "19.02.2026", "12.03.2026", "0.91", "USD", "×2", "16.3 kr", "🟢 Докупить"], ["3", "KLA Corp", "28.02.2026", "03.03.2026", "1.9", "USD", "×1", "17.0 kr", "⚪ Держать"], ["4", "NVIDIA", "12.03.2026", "02.04.2026", "0.01", "USD", "×5", "0.4 kr", "🟢 Докупить"], ["5", "Taiwan Semiconductor", "17.03.2026", "09.04.2026", "0.968", "USD", "×3", "25.9 kr", "🟢 Докупить"], ["6", "Broadcom", "20.03.2026", "31.03.2026", "0.59", "USD", "×3", "15.8 kr", "🟢 Докупить"], ["7", "Nordea Bank", "25.03.2026", "02.04.2026", "10.165", "SEK", "×150", "1,524.7 kr", "🟠 Сократить"], ["8", "Swedbank A", "25.03.2026", "31.03.2026", "20.45+9.35", "SEK", "×30", "894.0 kr", "⚪ Держать"], ["9", "Novo Nordisk B", "27.03.2026", "31.03.2026", "7.95", "DKK", "×10", "120.8 kr", "🟢 Докупить"], ["10", "Skanska B", "01.04.2026", "09.04.2026", "8.5+5.5", "SEK", "×40", "560.0 kr", "⚪ Держать"], ["11", "ASML Holding", "24.04.2026", "05.05.2026", "2.7", "EUR", "×1", "28.6 kr", "⚪ Держать"], ["12", "Solid Försäkring", "28.04.2026", "05.05.2026", "5.25+1.5", "SEK", "×50", "337.5 kr", "🔴 Продать"], ["13", "CellaVision", "29.04.2026", "06.05.2026", "2.75", "SEK", "×70", "192.5 kr", "⚪ Держать"], ["14", "Atlas Copco A", "29.04.2026", "06.05.2026", "1.5+1.0", "SEK", "×40", "100.0 kr", "⚪ Держать"], ["15", "Scandi Standard", "29.04.2026", "06.05.2026", "1.65", "SEK", "×45", "74.2 kr", "🔴 Продать"], ["16", "Vår Energi", "29.04.2026", "08.05.2026", "1.209", "NOK", "×100", "113.3 kr", "⚪ Держать"], ["17", "Hacksaw", "04.05.2026", "12.05.2026", "4.248", "SEK", "×100", "424.8 kr", "🔴 Продать"], ["18", "NCC B", "06.05.2026", "12.05.2026", "4.5+2.0", "SEK", "×30", "195.0 kr", "🔴 Продать"], ["19", "Loomis", "07.05.2026", "13.05.2026", "15+5", "SEK", "×20", "400.0 kr", "🔴 Продать"], ["20", "Investor AB", "08.05.2026", "15.05.2026", "4.0", "SEK", "×20", "80.0 kr", "⚪ Держать"], ["21", "EQT", "13.05.2026", "20.05.2026", "2.5", "SEK", "×35", "87.5 kr", "⚪ Держать"], ["22", "Rheinmetall", "15.05.2026", "16.05.2026", "8.1", "EUR", "×3", "257.3 kr", "🟠 Сократить"], ["23", "Tele2 B", "19.05.2026", "25.05.2026", "5.25", "SEK", "×40", "210.0 kr", "🔴 Продать"], ["24", "MilDef Group", "22.05.2026", "28.05.2026", "0.75", "SEK", "×100", "75.0 kr", "⚪ Держать"], ["25", "Taiwan Semiconductor", "11.06.2026", "09.07.2026", "0.950", "USD", "×3", "25.5 kr", "🟢 Докупить"], ["26", "Tele2 B", "12.10.2026", "16.10.2026", "5.25", "SEK", "×40", "210.0 kr", "🔴 Продать"], ["27", "Atlas Copco A", "19.10.2026", "23.10.2026", "1.5+1.0", "SEK", "×40", "100.0 kr", "⚪ Держать"], ["28", "NCC B", "04.11.2026", "10.11.2026", "4.5", "SEK", "×30", "135.0 kr", "🔴 Продать"], ["29", "Investor AB", "06.11.2026", "12.11.2026", "1.6", "SEK", "×20", "32.0 kr", "⚪ Держать"]]}, {"title": "📊 ПО СЕКТОРАМ (сейчас)", "headers": ["#", "Сектор", "Стоимость", "Доля"], "rows": [["1", "Оборона", "54,456 kr", "16.1%"], ["2", "Фармацевтика", "42,655 kr", "12.6%"], ["3", "Банки", "37,197 kr", "11.0%"], ["4", "Промышленность", "28,252 kr", "8.4%"], ["5", "Полупроводники", "23,162 kr", "6.9%"], ["6", "Строительство", "17,410 kr", "5.2%"], ["7", "Оборона IT", "14,250 kr", "4.2%"], ["8", "Чип-оборудование", "13,128 kr", "3.9%"], ["9", "PE Фонд", "10,633 kr", "3.2%"], ["10", "Мед. техника", "10,598 kr", "3.1%"], ["11", "AI инфраструктура", "9,028 kr", "2.7%"], ["12", "Логистика/Cash", "8,796 kr", "2.6%"], ["13", "ИИ / Чипы", "8,481 kr", "2.5%"], ["14", "Телеком", "7,572 kr", "2.2%"], ["15", "Холдинг", "7,349 kr", "2.2%"], ["16", "Software/Cloud", "7,211 kr", "2.1%"], ["17", "Гейминг", "5,810 kr", "1.7%"], ["18", "Продовольствие", "5,706 kr", "1.7%"], ["19", "Страхование", "5,220 kr", "1.5%"], ["20", "Фарма/GLP-1", "4,409 kr", "1.3%"], ["21", "Судостроение", "3,441 kr", "1.0%"], ["22", "Энергетика", "3,258 kr", "1.0%"], ["23", "Software/AI", "2,443 kr", "0.7%"], ["24", "Insurtech", "2,372 kr", "0.7%"], ["25", "Недвижимость (REIT)", "2,348 kr", "0.7%"], ["26", "Software/Design", "2,183 kr", "0.6%"]]}, {"title": "📊 ПО СЕКТОРАМ (цель)", "headers": ["#", "Сектор", "Целевая", "Доля"], "rows": [["1", "Фармацевтика", "26,989 kr", "8.4%"], ["2", "Полупроводники", "25,303 kr", "7.9%"], ["3", "Банки", "25,302 kr", "7.9%"], ["4", "Промышленность", "20,242 kr", "6.3%"], ["5", "ИИ / Чипы", "16,868 kr", "5.3%"], ["6", "Software/Cloud", "16,868 kr", "5.3%"], ["7", "AI инфраструктура", "15,182 kr", "4.7%"], ["8", "Consumer Staples", "15,182 kr", "4.7%"], ["9", "Оборона", "13,495 kr", "4.2%"], ["10", "Чип-оборудование", "11,808 kr", "3.7%"], ["11", "Фарма/GLP-1", "11,808 kr", "3.7%"], ["12", "Ритейл/Cloud", "11,808 kr", "3.7%"], ["13", "Оборона IT", "10,121 kr", "3.2%"], ["14", "Недвижимость (REIT)", "10,121 kr", "3.2%"], ["15", "Healthcare/MedTech", "10,121 kr", "3.2%"], ["16", "Строительство", "8,434 kr", "2.6%"], ["17", "Мед. техника", "8,434 kr", "2.6%"], ["18", "PE Фонд", "8,434 kr", "2.6%"], ["19", "Холдинг", "8,434 kr", "2.6%"], ["20", "Утилиты/Green Energy", "8,434 kr", "2.6%"], ["21", "Software/AI", "6,747 kr", "2.1%"], ["22", "Недвиж./Логистика", "6,747 kr", "2.1%"], ["23", "Авто/Промышленность", "6,747 kr", "2.1%"], ["24", "Consumer Staples 🥤", "6,747 kr", "2.1%"], ["25", "Энергетика", "5,061 kr", "1.6%"], ["26", "Судостроение", "3,374 kr", "1.1%"], ["27", "Software/Design", "1,687 kr", "0.5%"]]}, {"title": "🌍 ПО СТРАНАМ (сейчас)", "headers": ["#", "Страна", "Стоимость", "Доля"], "rows": [["1", "🇸🇪", "180,962 kr", "53.6%"], ["2", "🇩🇪", "54,456 kr", "16.1%"], ["3", "🇺🇸", "47,422 kr", "14.1%"], ["4", "🇳🇴", "23,744 kr", "7.0%"], ["5", "🇳🇱", "13,128 kr", "3.9%"], ["6", "🇹🇼", "9,806 kr", "2.9%"], ["7", "🇩🇰", "4,409 kr", "1.3%"], ["8", "🇮🇹", "3,441 kr", "1.0%"]]}, {"title": "🌍 ПО СТРАНАМ (цель)", "headers": ["#", "Страна", "Целевая", "Доля"], "rows": [["1", "🇺🇸", "133,259 kr", "41.6%"], ["2", "🇸🇪", "104,582 kr", "32.6%"], ["3", "🇳🇴", "16,869 kr", "5.3%"], ["4", "🇩🇪", "13,495 kr", "4.2%"], ["5", "🇹🇼", "13,495 kr", "4.2%"], ["6", "🇳🇱", "11,808 kr", "3.7%"], ["7", "🇩🇰", "11,808 kr", "3.7%"], ["8", "🇯🇵", "6,747 kr", "2.1%"], ["9", "🇬🇧", "5,061 kr", "1.6%"], ["10", "🇮🇹", "3,374 kr", "1.1%"]]}]}, "sma": {"OMXS30": {"price": 3145, "sma50": 3050, "sma100": 2920, "sma200": 2750, "signal": "Strong Buy"}, "Nasdaq 100": {"price": 21500, "sma50": 21200, "sma100": 20800, "sma200": 19500, "signal": "Buy"}, "OMXSPI": {"price": 1085, "sma50": 1040, "sma100": 990, "sma200": 930, "signal": "Strong Buy"}, "S&P 500": {"price": 6965, "sma50": 6800, "sma100": 6500, "sma200": 6000, "signal": "Strong Buy"}, "DAX 40": {"price": 25015, "sma50": 24200, "sma100": 23000, "sma200": 21000, "signal": "Strong Buy"}, "CAC 40": {"price": 8323, "sma50": 8100, "sma100": 7900, "sma200": 7500, "signal": "Buy"}, "FTSE MIB": {"price": 38200, "sma50": 37000, "sma100": 36000, "sma200": 34500, "signal": "Strong Buy"}, "OBX 25": {"price": 1613, "sma50": 1560, "sma100": 1500, "sma200": 1420, "signal": "Strong Buy"}}};
let DATA=ALL.data,RANK=ALL.rankings,SMA_IDX=ALL.sma;

// ===== Supabase sync config =====
// Create a free project at https://supabase.com, run the SQL in SETUP.md, then
// paste your Project URL + anon/publishable key below. Both are safe to expose
// in frontend code — your data is protected by login + Row-Level Security.
const SUPABASE_URL = 'https://fvrebkwczqmeorytujbn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9CIG7HU54hfBcexS4qr3rQ_HQygVVJC';
const SYNC_ENABLED = SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;
const sb = SYNC_ENABLED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentUser=null, realtimeChannel=null, pushTimer=null, applyingRemote=false, finnhubKey='', lastPushTs=0;
let manualPriceRows=new Set();   // portfolio row indices the last refresh couldn't price live

// The entire editable state, stored as one JSONB row per user.
function snapshotState(){
  return { data:DATA, rankings:RANK, sma:SMA_IDX, fx:FX, colOrders:colOrders,
           theme:(document.documentElement.dataset.theme||'light'), apiKey:finnhubKey,
           hiddenCols:hiddenCols, smaTf:SMA_TF };
}
// Call after any edit: debounce-push to the cloud.
function scheduleSave(){ if(currentUser && !applyingRemote) schedulePush(); }
function schedulePush(){ clearTimeout(pushTimer); pushTimer=setTimeout(pushState, 800); }

async function pushState(){
  if(!currentUser) return;
  const ts=new Date().toISOString();
  lastPushTs=Date.parse(ts);   // remember so the realtime echo of this push can be ignored
  const { error } = await sb.from('ledger_state')
    .upsert({ user_id:currentUser.id, data:snapshotState(), updated_at:ts });
  if(error) console.warn('Sync push failed', error);
}
async function pullState(){
  if(!currentUser) return;
  const { data, error } = await sb.from('ledger_state').select('data').eq('user_id',currentUser.id).maybeSingle();
  if(error){ console.warn('Sync pull failed', error); return; }
  if(data && data.data && Object.keys(data.data).length) applyRemoteState(data.data);
  else pushState();   // first login: seed the cloud with the bundled data
}
function applyRemoteState(s){
  applyingRemote=true;
  if(s.data) DATA=s.data;
  if(s.rankings) RANK=s.rankings;
  if(s.sma) SMA_IDX=s.sma;
  if(s.fx) FX=s.fx;
  if(s.colOrders) colOrders=s.colOrders;
  if(s.hiddenCols) hiddenCols=s.hiddenCols;
  if(s.smaTf) SMA_TF=s.smaTf;
  if(typeof s.apiKey==='string') finnhubKey=s.apiKey;
  if(s.theme) applyTheme(s.theme);
  applyingRemote=false;
  init();   // rebuild tabs (idempotent) + re-render with synced data
}
function subscribeRealtime(){
  if(realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel=sb.channel('dash_'+currentUser.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'ledger_state',filter:'user_id=eq.'+currentUser.id},
        p=>{ if(!(p.new && p.new.data)) return;
             if(lastPushTs && Date.parse(p.new.updated_at)===lastPushTs) return;   // our own push echoed back — skip the full re-render
             applyRemoteState(p.new.data); })
    .subscribe();
}

// ===== Roles & tab access (table user_access — see supabase-access.sql) =====
// Админ видит всё и раздаёт вкладки; новые аккаунты — роль user, только Nasdaq 100.
const ADMIN_EMAIL='dmitriy.bilokon@gmail.com';
let userRole='user', allowedTabs=['Nasdaq 100'], hbTimer=null;
const tabAllowed=n=>!SYNC_ENABLED||!currentUser||userRole==='admin'||(allowedTabs||[]).includes(n);
async function initAccess(){
  // Хардкод-фолбэк: владелец остаётся админом, даже если таблица ещё не создана.
  userRole=(currentUser.email||'').toLowerCase()===ADMIN_EMAIL?'admin':'user';
  try{
    const{data,error}=await sb.rpc('ensure_access');   // создаёт/обновляет свою строку, возвращает {role,tabs}
    if(!error&&data){
      if(data.role==='admin')userRole='admin';
      if(Array.isArray(data.tabs)&&userRole!=='admin')allowedTabs=data.tabs;
    }
  }catch(e){ console.warn('access init failed',e); }
  const st=document.getElementById('settingsBtn'); if(st)st.style.display=userRole==='admin'?'':'none';
  clearInterval(hbTimer);
  hbTimer=setInterval(()=>{ sb.rpc('heartbeat').then(()=>{},()=>{}) },60000);   // онлайн-статус для админа
}

// ===== Auth =====
async function handleLogin(e){
  e.preventDefault();
  const email=document.getElementById('authEmail').value.trim();
  const password=document.getElementById('authPassword').value;
  const btn=document.getElementById('authBtn'), err=document.getElementById('authError');
  err.textContent=''; btn.disabled=true; btn.textContent='Вход…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled=false; btn.textContent='Войти';
  if(error){ err.textContent=error.message; return; }
  currentUser=data.user; document.getElementById('authPassword').value='';
  await startApp();
}
async function handleLogout(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel=null; }
  clearInterval(hbTimer); userRole='user'; allowedTabs=['Nasdaq 100'];
  const st=document.getElementById('settingsBtn'); if(st)st.style.display='none';
  await sb.auth.signOut(); currentUser=null;
  document.getElementById('logoutBtn')?.style.setProperty('display','none');
  document.getElementById('authOverlay').classList.remove('hidden');
}
async function startApp(){
  document.getElementById('authOverlay').classList.add('hidden');
  const lo=document.getElementById('logoutBtn'); if(lo){ lo.style.display=''; lo.title='Выйти ('+currentUser.email+')'; }
  await initAccess();   // роль + вкладки до первой отрисовки синхронизированных данных
  await pullState();
  subscribeRealtime();
  refreshFX();   // override synced rates with live USD/EUR/NOK→SEK (non-blocking)
}
async function boot(){
  initTheme();
  init();                         // paint with bundled data first
  if(!SYNC_ENABLED){ refreshFX(); return; }
  const { data:{ session } } = await sb.auth.getSession();
  if(session){ currentUser=session.user; await startApp(); }
  else { document.getElementById('authOverlay').classList.remove('hidden'); }
}
const META={'OMXS30':'🇸🇪','Nasdaq 100':'🇺🇸','OMXSPI':'🇸🇪','S&P 500':'🇺🇸','DAX 40':'🇩🇪','CAC 40':'🇫🇷','FTSE MIB':'🇮🇹','OBX 25':'🇳🇴','🚀 Портфель 3.0':'🚀'};
let FX={SEK:1,EUR:10.59,USD:8.93,NOK:0.9375,DKK:1.52};
// Per-stock SMA timeframe: SMA_TF[ticker] = { mode:'1Y'|'3Y', d:[s50,s100,s200] (daily), w:[…] (weekly) }.
// The visible SMA columns show d (1Y) or w (3Y) per the stock's chosen mode. Persisted in snapshotState.
let SMA_TF={};
const SMA_TF_COL='Период SMA';
// ===== Live exchange rates (official mid-market, ≈ what Google shows) =====
// Base currency is SEK; FX[ccy] = how many SEK per 1 unit of ccy.
// Sources return "1 SEK = rates[ccy] ccy", so SEK-per-ccy = 1/rates[ccy].
// Tried in order; on total failure we keep whatever rates are already loaded.
const FX_CCYS=['USD','EUR','NOK','DKK'];
async function fetchRatesSEK(){
  const sources=[
    async()=>(await(await fetch('https://api.frankfurter.app/latest?from=SEK&to='+FX_CCYS.join(','))).json()).rates,            // ECB official reference rates
    async()=>{const j=await(await fetch('https://open.er-api.com/v6/latest/SEK')).json();return j&&j.result==='success'?j.rates:null;} // fallback
  ];
  for(const src of sources){
    try{
      const r=await src();
      if(r&&FX_CCYS.every(c=>typeof r[c]==='number'&&r[c]>0)){
        const out={};FX_CCYS.forEach(c=>out[c]=parseFloat((1/r[c]).toFixed(4)));return out;
      }
    }catch(e){}
  }
  return null;
}
async function refreshFX(){
  const live=await fetchRatesSEK();
  if(!live)return;                                  // network/source down → keep existing rates
  FX={...FX,SEK:1,...live};                          // override USD/EUR/NOK, preserve any other keys
  if(DATA[PF3_KEY])recalcAllPF(PF3_KEY);
  if(isV3())renderPF3();
  scheduleSave();                                    // persist live rates so the cloud + Telegram worker see them
}
const SEC_COLORS={'tech':['#dbeafe','#1e40af'],'software':['#c7d2fe','#3730a3'],'ai':['#c7d2fe','#3730a3'],'gpu':['#c7d2fe','#3730a3'],'semis':['#e0e7ff','#4338ca'],'information':['#dbeafe','#1e40af'],'health':['#dcfce7','#166534'],'pharma':['#dcfce7','#166534'],'biotech':['#d1fae5','#065f46'],'med':['#dcfce7','#166534'],'financ':['#fef3c7','#92400e'],'bank':['#fef3c7','#92400e'],'insurance':['#fef9c3','#854d0e'],'pe fund':['#fef3c7','#92400e'],'energy':['#ffedd5','#9a3412'],'oil':['#ffedd5','#9a3412'],'utilit':['#ecfccb','#3f6212'],'consumer':['#fce7f3','#9d174d'],'food':['#fce7f3','#9d174d'],'luxury':['#fdf2f8','#831843'],'industrial':['#e0f2fe','#075985'],'construction':['#e0f2fe','#075985'],'defense':['#fee2e2','#991b1b'],'naval':['#fee2e2','#991b1b'],'security':['#fee2e2','#991b1b'],'telecom':['#f3e8ff','#6b21a8'],'media':['#f3e8ff','#6b21a8'],'material':['#ccfbf1','#134e4a'],'gaming':['#ede9fe','#5b21b6'],'salmon':['#cffafe','#155e75'],'auto':['#f1f5f9','#334155'],'ship':['#e0f2fe','#075985']};
function getSC(s){s=(s||'').toLowerCase();for(const[k,[b,f]] of Object.entries(SEC_COLORS)){if(s.includes(k))return[b,f]}return['#f1f5f9','#475569']}
let curIdx='OMXS30',curSub='table',sortCol=-1,sortDir=0,searchTerm='',selected=new Set(),colOrders={},hiddenCols={},dragSrc=-1;
const isPF=()=>curIdx.startsWith('💼');
// The "v3" master-detail UI (body.v3 in styles.css) serves two tabs:
// Портфель 3.0 (full portfolio features) and Nasdaq 100 (index watchlist mode).
const PF3_KEY='🚀 Портфель 3.0';
const ANALYSIS_IDX='Nasdaq 100';
let v3Key=PF3_KEY;                  // which tab the v3 UI is currently bound to
const pf3D=()=>DATA[v3Key];
const isV3=()=>curIdx===PF3_KEY||curIdx===ANALYSIS_IDX;
const isAnalysis=()=>isPF()||curIdx===ANALYSIS_IDX;
// Currency for symbol resolution: the row's «Валюта» column if present, else USD (index tables like Nasdaq).
function rowCcy(row){const ci=DATA[curIdx].headers.findIndex(x=>/валют/i.test(x));return ci>=0?(row[ci]||''):'USD'}
function getOrd(){const n=DATA[curIdx].headers.length;if(!colOrders[curIdx])colOrders[curIdx]=DATA[curIdx].headers.map((_,i)=>i);else for(let i=0;i<n;i++)if(!colOrders[curIdx].includes(i))colOrders[curIdx].push(i);return colOrders[curIdx]}
function recalcPF(i,idx){const d=DATA[idx||curIdx],r=d.rows[i];const qty=parseFloat(r[6])||0,price=parseFloat(r[7])||0,buy=parseFloat(r[9])||0,ccy=String(r[8]||'SEK'),fxNow=FX[ccy]||1;r[13]=Math.round(qty*price*fxNow);r[11]=buy>0?r[13]-Math.round(qty*buy*fxNow):0;r[12]=buy>0?parseFloat(((price-buy)/buy*100).toFixed(2)):0}
function recalcAllPF(idx){const k=idx||curIdx;DATA[k].rows.forEach((_,i)=>recalcPF(i,k))}

// Ensure the portfolio has the analyst-target column (added by a feature update).
function migratePortfolio(){
  const pf = DATA['💼 Портфель 2.0']; if(!pf) return;
  if(pf.headers.indexOf('Аналит. таргет') === -1){
    pf.headers.push('Аналит. таргет');
    pf.rows.forEach(r => { while(r.length < pf.headers.length) r.push(''); });
    if(!applyingRemote) scheduleSave();
  }
}
// Seed the Портфель 3.0 tab and keep its holdings list in sync with Портфель 2.0:
// every PF2 ticker missing here is imported (qty / buy price carry over). Rows become
// PF3's own copies — later edits in 3.0 don't touch 2.0.
function migratePortfolio3(){
  const pf2=DATA['💼 Портфель 2.0'];
  if(!DATA[PF3_KEY])
    DATA[PF3_KEY]={headers:pf2?pf2.headers.slice():['#','Компания','Тикер','Страна','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','1д %','Прибыль','От покупки %','Стоимость','X-dag','Выплата','SMA 50','SMA 100','SMA 200','Целевая','Цель %','Действие'],rows:[],count:0,subtitle:'Портфель 3.0'};
  const d=DATA[PF3_KEY];
  let added=0;
  if(pf2){
    const have=new Set(d.rows.map(r=>String(r[2]||'').trim().toUpperCase()));
    const removed=new Set((d.removed||[]).map(s=>String(s).trim().toUpperCase()));   // user deleted these in 3.0 — don't re-import
    pf2.rows.forEach(r=>{
      const tk=String(r[2]||'').trim().toUpperCase();
      if(!tk||have.has(tk)||removed.has(tk))return;
      const row=r.slice();
      while(row.length<d.headers.length)row.push('');
      d.rows.push(row);have.add(tk);added++;
    });
  }
  if(!d.rows.length){   // no Портфель 2.0 in this state — fall back to the single MU seed
    d.rows.push([1,'Micron Technology','MU','🇺🇸','Полупроводники','Акция',0,0,'USD',0,0,0,0,0,'—','—','','','',0,0,'⚪ Держать']);
    added++;
  }
  if(added){
    d.rows.forEach((r,i)=>{r[0]=i+1});
    d.count=d.rows.length;
    if(!applyingRemote)scheduleSave();
  }
}
// One-time sync with the broker statement (Avanza screenshot, 2026-06-10):
// share counts + buy prices for both portfolio tabs, cash/leverage for the summary.
// Marked done via brokerSnap/cashSnap flags in the synced state, so it runs once.
function migrateBrokerSnap20260610(){
  const SNAP={MU:[5,509.48],AVGO:[6,408.08],BKNG:[10,156.55],RHM:[1,1196.60],O:[20,66.11],MSFT:[3,373.04],META:[2,573.42],GOOG:[3,288.00],NVDA:[5,174.10],MCHP:[8,99.17],AZN:[4,1659.75],MSTR:[5,123.30]};   // ticker → [qty, buy price]
  let touched=false;
  ['💼 Портфель 2.0',PF3_KEY].forEach(k=>{
    const d=DATA[k];
    if(!d||d.brokerSnap==='2026-06-10')return;
    d.rows.forEach((r,i)=>{
      const s=SNAP[String(r[2]||'').trim().toUpperCase()];
      if(!s)return;
      r[6]=s[0];r[9]=s[1];
      recalcPF(i,k);
    });
    d.brokerSnap='2026-06-10';
    touched=true;
  });
  // Cash semantics ('b' revision): 283 179 = весь капитал (акции + свободные),
  // store only свободные (113 848) and плечо (50 000); totals are computed live.
  const p3=DATA[PF3_KEY],p2=DATA['💼 Портфель 2.0'];
  if(p3&&p3.cashSnap!=='2026-06-10b'){
    p3.cashFree=113848;p3.leverage=50000;p3.cashSnap='2026-06-10b';
    delete p3.cash;   // obsolete field from the first revision
    if(p2)p2.cash=113848;   // PF2's «Кэш» card = свободные средства
    touched=true;
  }
  if(touched&&!applyingRemote)scheduleSave();
}
// Proper company names — manual adds and some imports stored the ticker as the name.
const PF3_NAMES={MU:'Micron Technology',AVGO:'Broadcom',BKNG:'Booking Holdings',RHM:'Rheinmetall',O:'Realty Income',MSFT:'Microsoft',META:'Meta Platforms',GOOG:'Alphabet (Class C)',NVDA:'NVIDIA',MCHP:'Microchip Technology',AZN:'AstraZeneca',MSTR:'Strategy (MicroStrategy)'};
// Sectors for rows that have none ('—'); applied only when the cell is empty.
const PF3_SECTORS={MU:'Полупроводники',AVGO:'Полупроводники',MCHP:'Полупроводники',AZN:'Фармацевтика',BKNG:'Путешествия / E-commerce',MSFT:'Software / Cloud',META:'Соцсети / Реклама',GOOG:'Search / Cloud',NVDA:'ИИ / Чипы',O:'Недвижимость (REIT)',RHM:'Оборона',MSTR:'Bitcoin / Software'};
// Avanza-style instrument types (r[5]): Защитная · Качественная · Циклическая ·
// Дивидендная · Рост · Стоимость (+ ETF/Фонд from the Yahoo quoteType, never
// overwritten). Recomputed on every load so a stale synced value heals itself:
// per-ticker map first, sector-based fallback for stocks added later.
const PF3_TYPE_META={'Защитная':['🛡','def'],'Качественная':['💎','qual'],'Циклическая':['🔄','cyc'],'Дивидендная':['💰','div'],'Рост':['🚀','gro'],'Стоимость':['📊','val'],'ETF':['🧺','etf'],'Фонд':['🧺','etf']};
const PF3_TYPES={
  // Портфель 3.0
  MU:'Циклическая',AVGO:'Качественная',MCHP:'Циклическая',AZN:'Защитная',BKNG:'Качественная',
  MSFT:'Качественная',META:'Рост',GOOG:'Качественная',GOOGL:'Качественная',NVDA:'Рост',
  O:'Дивидендная',PLD:'Дивидендная',RHM:'Рост',MSTR:'Рост',
  // Nasdaq 100 — мегакэпы / качество
  AAPL:'Качественная',AMZN:'Рост',NFLX:'Рост',TSLA:'Рост',COST:'Качественная',
  ASML:'Качественная',TXN:'Качественная',ADI:'Качественная',LIN:'Качественная',HON:'Качественная',
  INTU:'Качественная',ADBE:'Качественная',CRM:'Качественная',SNPS:'Качественная',CDNS:'Качественная',
  ADP:'Качественная',VRSK:'Качественная',CTAS:'Качественная',CPRT:'Качественная',ORLY:'Качественная',
  ROST:'Качественная',ODFL:'Качественная',EA:'Качественная',SBUX:'Качественная',MAR:'Циклическая',
  MNST:'Качественная',VRTX:'Качественная',MELI:'Рост',
  // Рост: ИИ, облако, кибербезопасность, биотех-спекулятивные
  AMD:'Рост',ARM:'Рост',MRVL:'Рост',SMCI:'Рост',PLTR:'Рост',APP:'Рост',TTD:'Рост',
  SNOW:'Рост',DDOG:'Рост',MDB:'Рост',TEAM:'Рост',WDAY:'Рост',CSGP:'Рост',
  PANW:'Рост',CRWD:'Рост',FTNT:'Рост',ZS:'Рост',ANET:'Рост',AXON:'Рост',DASH:'Рост',
  ISRG:'Рост',DXCM:'Рост',MRNA:'Рост',CEG:'Рост',GEV:'Рост',LCID:'Рост',
  // Циклические: полупроводниковое оборудование, память, авто, энергосервис
  AMAT:'Циклическая',LRCX:'Циклическая',KLAC:'Циклическая',INTC:'Циклическая',QCOM:'Циклическая',
  ON:'Циклическая',PCAR:'Циклическая',CDW:'Циклическая',BKR:'Циклическая',ENPH:'Циклическая',
  // Защитные: фарма, потребтовары, коммунальные, телеком
  GILD:'Защитная',GEHC:'Защитная',PEP:'Защитная',MDLZ:'Защитная',TMUS:'Защитная',EXC:'Защитная',
  // Дивидендные и стоимостные
  KHC:'Дивидендная',CSCO:'Дивидендная',
  CHTR:'Стоимость',WBD:'Стоимость',SIRI:'Стоимость',PYPL:'Стоимость',DLTR:'Стоимость',DG:'Стоимость',
};
const PF3_REIT_RE=/\breit\b|недвиж/i;
const PF3_DEF_RE=/фарма|pharma|здравоохран|health|медицин|потребительск|staples|consumer defensive|beverages|напитк|utilit|коммунал|телеком|telecom/i;
const PF3_GRO_RE=/software|облач|cloud|\bии\b|\bai\b|интернет|e-?comm|соцсет|social|биотех|biotech|кибер|cyber|данн|data|стриминг|streaming|search/i;
const PF3_CYC_RE=/полупровод|semicond|чип|chip|memory|авто|auto|truck|промышл|industrial|энерг|energy|нефть|oil|gas|сырь|материал|metal|банк|financ|финанс|туризм|travel|отел|hotel|транспорт|logistic|логистик|retail|ритейл|ресторан|restaurant|оборон|defense|aerospace/i;
function pf3DeriveType(tk,sec,cur){
  if(/etf|фонд/i.test(cur||''))return cur;
  if(PF3_TYPES[tk])return PF3_TYPES[tk];
  const s=sec||'';
  if(PF3_REIT_RE.test(s))return 'Дивидендная';
  if(PF3_DEF_RE.test(s))return 'Защитная';
  if(PF3_GRO_RE.test(s))return 'Рост';
  if(PF3_CYC_RE.test(s))return 'Циклическая';
  return 'Качественная';
}
function fixCompanyNames(){
  let touched=false;
  ['💼 Портфель 2.0',PF3_KEY,ANALYSIS_IDX].forEach(k=>{
    const d=DATA[k];if(!d)return;
    d.rows.forEach(r=>{
      const tk=String(r[2]||'').trim().toUpperCase();
      const proper=PF3_NAMES[tk],sec=PF3_SECTORS[tk];
      if(proper&&(!r[1]||String(r[1]).trim().toUpperCase()===tk)){r[1]=proper;touched=true;}
      if(sec&&(!r[4]||r[4]==='—')){r[4]=sec;touched=true;}
      const typ=pf3DeriveType(tk,r[4],r[5]);
      if(r[5]!==typ){r[5]=typ;touched=true;}
    });
  });
  if(touched&&!applyingRemote)scheduleSave();
}
// One-time: convert the Nasdaq 100 tab to the PF row schema so the v3
// master-detail UI (list + cards) can render it. Old columns are mapped by
// header name; qty/buy stay 0 (it's a watchlist, not a position list).
function migrateNasdaqV3(){
  const d=DATA[ANALYSIS_IDX],p3=DATA[PF3_KEY];
  if(!d||!p3||d.v3==='1')return;
  const oh=d.headers,find=re=>oh.findIndex(x=>re.test(String(x)));
  const o={sec:find(/сектор|отрасль/i),price:find(/^цена/i),day:find(/1д|день/i),tg:find(/аналит/i),s50:find(/sma.?50/i),s100:find(/sma.?100/i),s200:find(/sma.?200/i),sup:oh.indexOf('Поддержка'),res:oh.indexOf('Сопротивление'),div:find(/^дивид/i)};
  const nh=p3.headers.slice();
  const n={s50:nh.findIndex(x=>/sma.?50/i.test(x)),s100:nh.findIndex(x=>/sma.?100/i.test(x)),s200:nh.findIndex(x=>/sma.?200/i.test(x)),sup:nh.indexOf('Поддержка'),res:nh.indexOf('Сопротивление'),tg:nh.findIndex(x=>/аналит/i.test(x))};
  const num=(r,i)=>i>=0?(parseFloat(r[i])||0):0;
  const rows=d.rows.filter(r=>String(r[2]||'').trim()).map((r,i)=>{
    const row=new Array(nh.length).fill('');
    row[0]=i+1;row[1]=r[1]||r[2];row[2]=String(r[2]).trim();row[3]='🇺🇸';row[4]=o.sec>=0?(r[o.sec]||'—'):'—';row[5]='Акция';
    row[6]=0;row[7]=num(r,o.price);row[8]='USD';row[9]=0;row[10]=num(r,o.day);
    row[11]=0;row[12]=0;row[13]=0;row[14]='—';row[15]=o.div>=0?(r[o.div]||'—'):'—';
    if(n.s50>=0)row[n.s50]=num(r,o.s50)||'';
    if(n.s100>=0)row[n.s100]=num(r,o.s100)||'';
    if(n.s200>=0)row[n.s200]=num(r,o.s200)||'';
    if(n.sup>=0&&o.sup>=0)row[n.sup]=num(r,o.sup)||'';
    if(n.res>=0&&o.res>=0)row[n.res]=num(r,o.res)||'';
    if(n.tg>=0)row[n.tg]=num(r,o.tg)||'';
    return row;
  });
  DATA[ANALYSIS_IDX]={headers:nh,rows,count:rows.length,subtitle:d.subtitle||'Nasdaq 100',v3:'1'};
  if(!applyingRemote)scheduleSave();
}
// Портфель 2.0 is retired — Портфель 3.0 owns the holdings now. Runs after
// migratePortfolio3 so a fresh state still seeds 3.0 from the bundled 2.0 data.
function migrateRemovePF2(){
  if(DATA['💼 Портфель 2.0']){
    delete DATA['💼 Портфель 2.0'];
    if(!applyingRemote)scheduleSave();
  }
}
function init(){migratePortfolio();migratePortfolio3();migrateBrokerSnap20260610();fixCompanyNames();migrateNasdaqV3();migrateRemovePF2();const keys=Object.keys(DATA).filter(tabAllowed);if(!DATA[curIdx]||!tabAllowed(curIdx))curIdx=keys[0]||Object.keys(DATA)[0];const t=document.getElementById('tabs');t.innerHTML='';keys.forEach(n=>{const el=document.createElement('div');el.className='tab'+(n===curIdx?' active':'');el.dataset.tab=n;el.innerHTML=`${META[n]||''} ${n}<span class="cnt">${DATA[n].count}</span>`;el.onclick=()=>{curIdx=n;sortCol=-1;sortDir=0;curSub='table';selected.clear();renderAll()};t.appendChild(el)});renderAll()}

function renderAll(){
  document.querySelectorAll('.tab').forEach(t=>{t.className='tab'+(t.dataset.tab===curIdx?' active':'')});
  const st=document.getElementById('subTabs');st.innerHTML='';
  document.body.classList.toggle('v3',isV3());   // Портфель 3.0 restyles the whole site
  const pf3El=document.getElementById('pf3Area');
  if(isV3()){
    if(v3Key!==curIdx){   // switched between Портфель 3.0 and Nasdaq 100 — rebind the v3 UI
      v3Key=curIdx;pf3Sel=null;pf3Tab='list';pf3TypeSel=null;
      pf3Sort=curIdx===PF3_KEY?{key:'val',dir:-1}:{key:'day',dir:-1};   // index default: top movers first
    }
    ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
    document.getElementById('smaBanner').innerHTML='';
    const isPort=v3Key===PF3_KEY;
    if(!isPort&&!['list','cal','sec','typ'].includes(pf3Tab))pf3Tab='list';
    (isPort
      ?[['📊 Портфель','list'],['🏭 Сектора','sec'],['🏷 Тип','typ'],['📅 Дивиденды и отчёты','cal'],['🩺 Состояние портфеля','health'],['🤖 AI Assistant','ai'],['⚖️ Предложение','prop']]
      :[['📊 Акции','list'],['🏭 Сектора','sec'],['🏷 Тип','typ'],['📅 Дивиденды и отчёты','cal']]
    ).forEach(([l,k])=>{const b=document.createElement('div');b.className='sub-tab'+(pf3Tab===k?' active':'');b.textContent=l;b.onclick=()=>{pf3Tab=k;renderAll()};st.appendChild(b)});
    if(pf3El)pf3El.style.display='';
    renderPF3();
    pf3EnsureAutoRefresh();
    return;
  }
  pf3StopAutoRefresh();
  if(pf3El)pf3El.style.display='none';
  // Classic index tabs (OMXS30, S&P 500, …): table + ranking sub-tabs.
  const subs=[['📊 Таблица','table'],['🏆 Рейтинг','ranking']];
  subs.forEach(([l,k])=>{if(k==='ranking'&&!(RANK[curIdx]?.length))return;const b=document.createElement('div');b.className='sub-tab'+(curSub===k?' active':'');b.textContent=l;b.onclick=()=>{curSub=k;renderAll()};st.appendChild(b)});
  const smB=document.getElementById('smaBanner');smB.innerHTML='';smB.style.display='';renderSMA();
  document.getElementById('tableArea').style.display=curSub==='table'?'':'none';
  document.getElementById('rankingArea').style.display=curSub==='ranking'?'':'none';
  document.getElementById('toolbarEl').style.display=curSub==='table'?'':'none';
  document.getElementById('statsBar').style.display=curSub==='table'?'':'none';
  if(curSub==='table')renderTable();
  else if(curSub==='ranking')renderRanking();
}

function renderSMA(){const b=document.getElementById('smaBanner');const s=SMA_IDX[curIdx];if(!s)return;const mk=(l,v,ab)=>{const d=document.createElement('div');d.className='sma-card';d.innerHTML=`<div><div class="sma-label">${l}</div><div class="sma-val ${ab?'sma-above':'sma-below'}">${typeof v==='number'?v.toLocaleString():v}</div></div>`;return d};b.appendChild(mk('Индекс',s.price,true));b.appendChild(mk('SMA 50',s.sma50,s.price>s.sma50));b.appendChild(mk('SMA 100',s.sma100,s.price>s.sma100));b.appendChild(mk('SMA 200',s.sma200,s.price>s.sma200));const sig=document.createElement('div');sig.className='sma-signal '+(s.signal.includes('Strong')?'sig-sbuy':s.signal.includes('Sell')?'sig-sell':'sig-buy');sig.textContent=s.signal;b.appendChild(sig)}

function renderTable(){
  const d=DATA[curIdx],h=d.headers,ord=getOrd(),rows=getFiltered();
  document.getElementById('indexInfo').textContent=d.subtitle||curIdx;
  renderStats(rows,h);updateDelBtn();
  const priceC=h.findIndex(x=>/^цена/i.test(x)),s50=h.findIndex(x=>/sma.?50/i.test(x)),s100=h.findIndex(x=>/sma.?100/i.test(x)),s200=h.findIndex(x=>/sma.?200/i.test(x)),tfC=h.indexOf(SMA_TF_COL),supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление');
  const thead=document.getElementById('thead');thead.innerHTML='';const tr=document.createElement('tr');
  const thD=document.createElement('th');thD.style.width='28px';tr.appendChild(thD);
  ord.forEach((ci,vi)=>{if((hiddenCols[curIdx]||[]).includes(ci))return;const th=document.createElement('th');th.textContent=h[ci];th.draggable=true;th.dataset.vi=vi;if(ci===sortCol)th.className=sortDir===1?'sorted-asc':'sorted-desc';th.onclick=()=>toggleSort(ci);th.addEventListener('dragstart',()=>{dragSrc=vi;th.classList.add('dragging')});th.addEventListener('dragend',()=>{th.classList.remove('dragging');document.querySelectorAll('thead th').forEach(t=>t.classList.remove('drag-over'))});th.addEventListener('dragover',e=>{e.preventDefault();th.classList.add('drag-over')});th.addEventListener('dragleave',()=>th.classList.remove('drag-over'));th.addEventListener('drop',e=>{e.preventDefault();th.classList.remove('drag-over');const tgt=parseInt(th.dataset.vi);if(dragSrc!==tgt){const o=getOrd();const it=o.splice(dragSrc,1)[0];o.splice(tgt,0,it);renderAll();scheduleSave()}});tr.appendChild(th)});
  thead.appendChild(tr);
  const tbody=document.getElementById('tbody');tbody.innerHTML='';
  rows.forEach(row=>{const oi=row._idx,tr=document.createElement('tr');if(selected.has(oi))tr.className='selected';const tdD=document.createElement('td');tdD.style.cssText='padding:3px;text-align:center';const isPlanned=parseInt(row.data[6])===0;if(isPlanned){tr.style.background='rgba(234,179,8,0.06)';tr.style.borderLeft='3px solid var(--gold)'}const btn=document.createElement('button');btn.className='del-btn';btn.textContent='✕';btn.onclick=e=>{e.stopPropagation();if(selected.has(oi))selected.delete(oi);else selected.add(oi);updateDelBtn();tr.className=selected.has(oi)?'selected':''};tdD.appendChild(btn);tr.appendChild(tdD);const price=priceC>=0?parseFloat(row.data[priceC]):0;
  ord.forEach(ci=>{if((hiddenCols[curIdx]||[]).includes(ci))return;const val=row.data[ci],td=document.createElement('td');
  if(ci===tfC){td.style.textAlign='center';const tk=String(row.data[2]||'');const mode=(SMA_TF[tk]&&SMA_TF[tk].mode)||'1Y';const mk=(m,l)=>`<button class="tf-btn${mode===m?' tf-on':''}" onclick="setSmaTF(${oi},'${m}')">${l}</button>`;td.innerHTML=`<span class="tf-wrap">${mk('1Y','1Г')}${mk('3Y','3Г')}</span>`;tr.appendChild(td);return}
  if((ci===1||(h[ci]||'').toLowerCase().includes('компани'))&&isAnalysis()&&String(row.data[2]||'').trim()){td.className='c-company';td.style.cursor='pointer';td.title='Открыть график';td.innerHTML=`<span style="text-decoration:underline dotted">${val??''}</span> 📈`;td.onclick=()=>openStockChart(String(row.data[2]));tr.appendChild(td);return}
  td.contentEditable='true';td.spellcheck=false;const hdr=(h[ci]||'').toLowerCase();const isSec=hdr.includes('сектор')||hdr.includes('отрасль');const isSma=(ci===s50||ci===s100||ci===s200);const isLevel=isSma||ci===supC||ci===resC;
  if(isSec){const[bg,fg]=getSC(String(val));td.innerHTML=`<span class="sec-tag" style="background:${bg};color:${fg}">${val||''}</span>`}
  else if(isLevel&&price>0){const lv=parseFloat(val);if(!isNaN(lv)&&lv>0){const pct=(price-lv)/price*100;const ord=(ci===resC)?'X':(ci===supC)?'Y':(pct>=0?'X':'Y');const col=lvlPctColor(Math.abs(pct),ord);const vTxt=isSma?lv.toFixed(0):lv;td.innerHTML=`${vTxt} <span class="lvl-pct" style="color:${col}">(${pct>=0?'+':'−'}${Math.abs(pct).toFixed(1)}%)</span>`;if(isSma)td.className=price>lv?'c-sma-above':'c-sma-below'}else td.textContent=val??''}
  else{const isNum=typeof val==='number';if(hdr.includes('прибыль')||hdr.includes('стоимость')||hdr.includes('белайн')){td.textContent=isNum?Math.round(val).toLocaleString():(val??'');if(hdr.includes('прибыль')){const n=parseFloat(val);td.className=n>0?'c-pos':n<0?'c-neg':''}}else if(hdr.includes('курс')){td.textContent=isNum?val.toFixed(4):(val??'');td.style.fontFamily='"JetBrains Mono",monospace';td.style.fontSize='10px';td.style.color='var(--text2)'}else{td.textContent=val===null||val===undefined?'':val;if(ci<=1||hdr.includes('компани'))td.className='c-company';else if(ci===2||hdr.includes('тикер'))td.className='c-ticker';else if(hdr.includes('коммент'))td.className='c-comment';else if((hdr.includes('sma')||hdr.includes('позиц'))&&!isSma){const v=String(val);td.className=v.includes('🟢')?'c-sma-g':v.includes('🔴')?'c-sma-r':'c-sma-y'}else if(hdr.includes('потенц')||hdr.includes('от покупки')){const n=parseFloat(String(val));if(!isNaN(n))td.className=n>0?'c-pos':n<0?'c-neg':'c-neut'}else if(hdr.includes('1д')||hdr.includes('день')){const n=parseFloat(String(val));if(!isNaN(n))td.className=n>0?'c-pos':n<0?'c-neg':'c-neut'}else if(hdr.includes('див')){const n=parseFloat(String(val));if(!isNaN(n)&&n>=5)td.className='c-div-hi';else if(!isNaN(n)&&n>=3)td.className='c-div-mid'}else if(hdr.includes('валюта')){td.style.fontWeight='600';td.style.color='var(--accent)'}else if(hdr.includes('целевая')||hdr.includes('цель')){td.style.color='var(--gold)';td.style.fontWeight='600';if(hdr.includes('kr')){const n=parseFloat(String(val));if(!isNaN(n))td.textContent=Math.round(n).toLocaleString()}}}}
  td.addEventListener('blur',()=>{const nv=td.textContent.replace(/\s/g,'').replace(/,/g,'');const num=parseFloat(nv);const keep=hdr.includes('валют')||hdr.includes('стран')||hdr.includes('сектор')||hdr.includes('компани')||hdr.includes('тикер')||nv.includes('⭐')||nv.includes('🟢')||nv.includes('🔴');d.rows[oi][ci]=keep?nv:(!isNaN(num)?num:nv);renderStats(getFiltered(),h);scheduleSave()});tr.appendChild(td)});
  tbody.appendChild(tr)})}

function getFiltered(){const d=DATA[curIdx];let rows=d.rows.map((r,i)=>({data:r,_idx:i}));if(searchTerm){const s=searchTerm.toLowerCase();rows=rows.filter(r=>r.data.some(v=>String(v).toLowerCase().includes(s)))}if(sortCol>=0&&sortDir>0)rows.sort((a,b)=>{let va=a.data[sortCol],vb=b.data[sortCol];const na=parseFloat(va),nb=parseFloat(vb);if(!isNaN(na)&&!isNaN(nb))return sortDir===1?na-nb:nb-na;return sortDir===1?String(va||'').localeCompare(String(vb||'')):String(vb||'').localeCompare(String(va||''))});return rows}
function toggleSort(c){if(sortCol===c){sortDir=(sortDir+1)%3;if(!sortDir)sortCol=-1}else{sortCol=c;sortDir=1}renderAll()}
function resetSort(){sortCol=-1;sortDir=0;searchTerm='';document.getElementById('searchBox').value='';selected.clear();colOrders[curIdx]=null;hiddenCols[curIdx]=[];scheduleSave();renderAll()}
function updateDelBtn(){const b=document.getElementById('delBtn');b.style.display=selected.size?'':'none';b.textContent=`🗑 (${selected.size})`}
function deleteSelected(){if(!selected.size||!confirm(`Удалить ${selected.size}?`))return;const d=DATA[curIdx];[...selected].sort((a,b)=>b-a).forEach(i=>d.rows.splice(i,1));d.count=d.rows.length;selected.clear();colOrders[curIdx]=null;scheduleSave();document.querySelectorAll('.tab').forEach((t,i)=>{const n=Object.keys(DATA)[i];if(n===curIdx)t.innerHTML=`${META[n]||''} ${n}<span class="cnt">${d.count}</span>`});renderAll()}
function renderStats(rows,h){const bar=document.getElementById('statsBar');bar.innerHTML='';const fc=kw=>h.findIndex(x=>kw.some(k=>x.toLowerCase().includes(k)));const nv=col=>rows.map(r=>parseFloat(r.data[col])).filter(n=>!isNaN(n));const pC=fc(['потенц']),dC=fc(['див','дивид']),yC=fc(['1д','день']);const st=[{l:'Компаний',v:rows.length,c:'sv-blue'}];if(pC>=0){const v=nv(pC);if(v.length)st.push({l:'Ср. потенциал',v:'+'+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)+'%',c:'sv-green'})}if(dC>=0){const v=nv(dC);if(v.length)st.push({l:'Ср. дивиденд',v:(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)+'%',c:'sv-gold'})}if(pC>=0){const v=nv(pC);st.push({l:'Strong Buy',v:v.filter(x=>x>10).length,c:'sv-green'})}const s2=fc(['sma 200','sma200']),pc=fc(['цена','price']);if(s2>=0&&pc>=0){let ab=0,tot=0;rows.forEach(r=>{const p=parseFloat(r.data[pc]),sv=parseFloat(r.data[s2]);if(!isNaN(p)&&!isNaN(sv)&&sv>0){tot++;if(p>sv)ab++}});if(tot)st.push({l:'>SMA200',v:`${ab}/${tot}`,c:ab/tot>.6?'sv-green':'sv-red'})}st.forEach(s=>{const c=document.createElement('div');c.className='stat-card';c.innerHTML=`<div class="stat-label">${s.l}</div><div class="stat-value ${s.c}">${s.v}</div>`;bar.appendChild(c)})}
function renderRanking(){const a=document.getElementById('rankingArea');a.innerHTML='';const sec=RANK[curIdx]||[];if(!sec.length){a.innerHTML='<p style="padding:24px;color:var(--text2)">Нет данных</p>';return}sec.forEach(s=>{const d=document.createElement('div');d.className='ranking-section';const t=document.createElement('div');t.className='ranking-title';const tt=s.title;if(tt.includes('✅')||tt.includes('ПРИБЫЛ')||tt.includes('ПОТЕНЦИАЛ'))t.className+=' rt-green';else if(tt.includes('🔴')||tt.includes('УБЫТ'))t.className+=' rt-red';else if(tt.includes('💰'))t.className+=' rt-blue';else t.className+=' rt-purple';t.textContent=tt;d.appendChild(t);const tb=document.createElement('table');tb.className='ranking-table';if(s.headers?.length){const th=document.createElement('thead');const tr=document.createElement('tr');s.headers.forEach(h=>{const c=document.createElement('th');c.textContent=h;tr.appendChild(c)});th.appendChild(tr);tb.appendChild(th)}const bd=document.createElement('tbody');s.rows.forEach(r=>{const tr=document.createElement('tr');r.forEach((v,ci)=>{const td=document.createElement('td');td.textContent=v||'';td.contentEditable='true';td.spellcheck=false;if(ci===1)td.style.fontWeight='600';if(ci>=2){const vv=String(v);if(vv.includes('+'))td.style.color='var(--green-t)';else if(vv.includes('-'))td.style.color='var(--red-t)';if(ci<=3)td.style.fontWeight='600'}tr.appendChild(td)});bd.appendChild(tr)});tb.appendChild(bd);d.appendChild(tb);a.appendChild(d)})}
function exportCSV(){const d=DATA[curIdx],ord=getOrd();const hdr=ord.map(i=>d.headers[i]);const rows=[hdr,...d.rows.map(r=>ord.map(i=>r[i]))];const csv=rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=curIdx.replace(/\s/g,'_')+'_data.csv';a.click()}
// Debounced: re-render only the table (with its stats), not the whole app, and not on every keystroke.
let searchTimer=null;
document.getElementById('searchBox').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTerm=e.target.value;renderTable()},150)});

/* ===== Theme (light/dark) ===== */
function applyTheme(t){
  document.documentElement.dataset.theme = (t === 'dark' ? 'dark' : 'light');
  try{ localStorage.setItem('dash_theme', document.documentElement.dataset.theme); }catch(e){}
  const b = document.getElementById('themeToggle');
  if(b) b.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
  scheduleSave();
}
// FAQ (❓ in the header): legend for every badge / value used on the site.
// Reuses the live badge classes (pf3-typ / pf3-crit / pf3-sig) so the modal
// always looks exactly like the lists.
function faqHTML(){
  const row=(k,v)=>`<div class="faq-row"><span class="faq-k">${k}</span><span class="faq-v">${v}</span></div>`;
  const typ=(t,v)=>row(`<span class="pf3-typ ${PF3_TYPE_META[t][1]}">${PF3_TYPE_META[t][0]} ${t}</span>`,v);
  const crit=(cls,ico,l,v)=>row(`<span class="pf3-crit ${cls}">${ico} ${l}</span>`,v);
  return`<button class="faq-close" onclick="toggleFaq()">✕</button>
  <h2>❓ Справка по обозначениям</h2>
  <div class="faq-sub">Что означают бейджи, колонки и оценки на вкладках Портфель 3.0 и Nasdaq 100</div>

  <div class="faq-sec"><h3>Тип акции</h3>
    ${typ('Защитная','Стабильный спрос вне зависимости от экономического цикла: фарма, потребительские товары, коммунальные услуги, телеком. Меньше падает в кризис, медленнее растёт на бычьем рынке.')}
    ${typ('Качественная','Сильный баланс, высокая рентабельность, устойчивое конкурентное преимущество (Apple, Microsoft, ASML). Костяк долгосрочного портфеля.')}
    ${typ('Циклическая','Результаты сильно зависят от фазы экономики и отраслевого цикла: полупроводниковое оборудование, память, авто, промышленность, энергетика.')}
    ${typ('Дивидендная','Главная ценность — стабильные выплаты: REIT (Realty Income), Cisco, Kraft Heinz. Покупается ради денежного потока.')}
    ${typ('Рост','Быстрорастущая выручка, прибыль реинвестируется: ИИ, облако, кибербезопасность. Выше потенциал — выше волатильность.')}
    ${typ('Стоимость','Торгуется дёшево относительно прибыли/активов, часто в ожидании разворота (PayPal, Warner Bros). Ставка на переоценку рынком.')}
    ${typ('ETF','Биржевой фонд — корзина бумаг одним инструментом. Определяется автоматически при добавлении.')}
  </div>

  <div class="faq-sec"><h3>Критерий — рыночная фаза (техника + фундаментал)</h3>
    ${crit('knife','🔪','Падающий нож','Цена ниже всех SMA и дневное падение ≤ −3%, либо пробита поддержка. Ловить не стоит — ждать стабилизации.')}
    ${crit('down','📉','Даунтренд','Цена ниже SMA 50, 100 и 200 — нисходящий тренд на всех горизонтах.')}
    ${crit('corr','⚠️','Коррекция','Откат ниже SMA 50 при цене выше SMA 200 — долгосрочный тренд цел, краткосрочная слабость.')}
    ${crit('flat','⚖️','Боковик','Цена между уровнями без выраженного тренда, или недостаточно данных.')}
    ${crit('rev','🔄','Разворот','Цена вернулась выше SMA 50, но ещё ниже SMA 200 — возможное начало восстановления.')}
    ${crit('undr','💎','Недооценка','Потенциал до консенсус-таргета аналитиков ≥ +25% (и бумага не в свободном падении).')}
    ${crit('up','📈','Аптренд','Цена выше всех SMA 50/100/200 — восходящий тренд подтверждён.')}
    ${crit('imp','🚀','Импульс','Сильное дневное движение вверх: ≥ +2.5% при цене выше SMA 50 (или ≥ +4%).')}
    ${crit('heat','🌡','Перегрев','Цена выше таргета аналитиков (+5%) или ≥ +30% над SMA 200 — риск отката, фиксация части позиции разумна.')}
  </div>

  <div class="faq-sec"><h3>Сигнал — цена у технического уровня (±2%)</h3>
    ${row('<span class="pf3-sig pf3-sig-buy">🟢 Докупка · SMA 50 +1.2%</span>','Цена в пределах ±2% от уровня покупки (SMA 50/100/200 или поддержка). «Покупка» — если позиции ещё нет.')}
    ${row('<span class="pf3-sig pf3-sig-sell">🔴 Продажа · Сопр. −0.8%</span>','Цена в пределах ±2% от сопротивления — зона фиксации прибыли.')}
    ${row('<span class="pf3-sig pf3-sig-wait">⏳ SMA 100 −5.4%</span>','Уровней рядом нет; показан ближайший уровень покупки снизу и сколько до него.')}
    ${row('<span class="pf3-sig pf3-sig-warn">🔻 ниже уровней</span>','Цена опустилась ниже всех уровней покупки.')}
  </div>

  <div class="faq-sec"><h3>Технические уровни и колонки</h3>
    ${row('<b>SMA 50/100/200</b>','Скользящие средние по дневным свечам (~2.5/5/10 месяцев). В режиме «3 года» — недельные (~1/2/4 года). Обновляются автоматически.')}
    ${row('<b>Поддержка / Сопротивление</b>','Минимум и максимум цены за последние ~3 месяца торгов.')}
    ${row('<b>Аналит. таргет</b>','Средняя целевая цена аналитиков (консенсус FMP / Yahoo-Refinitiv) в валюте торгов. Рядом — потенциал в % к текущей цене.')}
    ${row('<b>1д %</b>','Изменение цены к закрытию предыдущей сессии.')}
    ${row('<b>Доля</b>','Вес позиции в общей стоимости акций портфеля.')}
  </div>

  <div class="faq-sec"><h3>Портфельные значения</h3>
    ${row('<b>Покупка</b>','Средняя цена входа в валюте бумаги (из брокерского отчёта).')}
    ${row('<b>Стоимость</b>','Текущая стоимость позиции в кронах по живому курсу (kr); под ней — прибыль/убыток в % к вложенному.')}
    ${row('<b>Чистый капитал</b>','Стоимость всех акций + свободный кэш.')}
    ${row('<b>Кредитное плечо</b>','Доступный кредит брокера сверх собственного капитала; «Доступно с плечом» = свободные + плечо.')}
  </div>

  <div class="faq-sec"><h3>Здоровье бизнеса (карточка акции)</h3>
    ${row('<b>Оценка 0–10</b>','Баланс (долг/капитал, ликвидность), денежный поток (FCF) и рост выручки (CAGR и год-к-году); итог — среднее. Переключатель: «Годовой отчёт» — последний фискальный год, «Послед. квартал» — свежий квартал + TTM.')}
    ${row('🔴 Критично · 🟠 Слабо · 🟡 Средне · 🟢 Хорошо · 🏆 Отлично','Градация итоговой оценки: &lt;2.5 · 2.5–4.5 · 4.5–6.5 · 6.5–8.5 · ≥8.5.')}
  </div>`;
}
// ===== Settings (⚙️, admin only): users, online status, per-tab access =====
function toggleSettings(){
  const o=document.getElementById('setOverlay');
  if(!o)return;
  if(!o.classList.contains('hidden')){o.classList.add('hidden');return;}
  o.classList.remove('hidden');
  document.getElementById('setCard').innerHTML='<button class="faq-close" onclick="toggleSettings()">✕</button><h2>⚙️ Настройки доступа</h2><div class="faq-sub">Загрузка…</div>';
  renderSettings();
}
async function renderSettings(){
  const card=document.getElementById('setCard');
  let users=[];
  try{
    const{data,error}=await sb.from('user_access').select('*').order('email');
    if(error)throw error;
    users=data||[];
  }catch(e){
    card.innerHTML=`<button class="faq-close" onclick="toggleSettings()">✕</button><h2>⚙️ Настройки доступа</h2>
      <div class="set-err">Не удалось загрузить пользователей: ${e.message||e}<br><br>
      Скорее всего, таблица доступа ещё не создана — выполните содержимое файла
      <code>supabase-access.sql</code> в Supabase → SQL Editor (один раз).</div>`;
    return;
  }
  const tabs=Object.keys(DATA);
  const ago=ts=>{const m=Math.round((Date.now()-Date.parse(ts))/60000);
    return m<3?'только что':m<60?`${m} мин назад`:m<1440?`${Math.round(m/60)} ч назад`:new Date(ts).toLocaleDateString('ru-RU')};
  const rows=users.map(u=>{
    const on=u.last_seen&&(Date.now()-Date.parse(u.last_seen))<150000;   // heartbeat раз в минуту → онлайн = < 2.5 мин
    const seen=on?'<span class="set-on">🟢 онлайн</span>':`<span class="set-off">⚪ ${u.last_seen?ago(u.last_seen):'не заходил'}</span>`;
    const adm=u.role==='admin';
    const grants=adm?'<span class="set-all">полный доступ ко всем вкладкам</span>'
      :tabs.map(t=>`<label class="set-tab"><input type="checkbox"${(u.tabs||[]).includes(t)?' checked':''} onchange="setGrant('${u.user_id}','${t.replace(/'/g,"\\'")}',this.checked)"><span>${META[t]||''} ${t}</span></label>`).join('');
    return`<div class="set-user">
      <div class="set-user-hd"><b>${u.email||u.user_id}</b><span class="set-role${adm?' adm':''}">${adm?'Админ':'User'}</span>${seen}</div>
      <div class="set-tabs">${grants}</div>
    </div>`;
  }).join('');
  card.innerHTML=`<button class="faq-close" onclick="toggleSettings()">✕</button><h2>⚙️ Настройки доступа</h2>
    <div class="faq-sub">Доступ к вкладкам и активность · 🟢 = на сайте сейчас · <a href="#" onclick="renderSettings();return false">обновить</a></div>
    ${rows||'<div class="set-err">Других пользователей пока нет — они появятся здесь после первого входа.</div>'}
    <div class="set-note">Изменения доступа применяются у пользователя после обновления страницы. Каждый видит свою копию данных вкладки.</div>`;
}
// Toggle one tab for one user; reread → modify → write, чтобы не затереть параллельные правки.
async function setGrant(uid,tab,on){
  try{
    const{data,error}=await sb.from('user_access').select('tabs').eq('user_id',uid).single();
    if(error)throw error;
    let t=Array.isArray(data?.tabs)?data.tabs:[];
    t=on?[...new Set([...t,tab])]:t.filter(x=>x!==tab);
    const r=await sb.from('user_access').update({tabs:t}).eq('user_id',uid);
    if(r.error)throw r.error;
  }catch(e){ alert('Не удалось сохранить доступ: '+(e.message||e)); renderSettings(); }
}

function toggleFaq(){
  const o=document.getElementById('faqOverlay');
  if(!o)return;
  if(o.classList.contains('hidden')){document.getElementById('faqCard').innerHTML=faqHTML();o.classList.remove('hidden');}
  else o.classList.add('hidden');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')['faqOverlay','setOverlay'].forEach(id=>document.getElementById(id)?.classList.add('hidden'))});

function toggleTheme(){
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}
function initTheme(){
  applyTheme(localStorage.getItem('dash_theme') || document.documentElement.dataset.theme || 'light');
}

/* ===== Live prices =====
   Preferred: a tiny price proxy (Cloudflare Worker — see price-proxy.js) that
   reads Yahoo Finance server-side, covering US + Nordic/EU (.ST/.OL/.DE/.CO).
   Paste your deployed Worker URL into PRICE_PROXY below.
   Fallback (PRICE_PROXY blank): Finnhub free tier — US tickers only. */
const PRICE_PROXY = 'https://telegram-notify-abc.dmitriy-bilokon.workers.dev';   // Worker serves live prices (US + Nordic/EU via Yahoo)

// Map a dashboard ticker + currency to a Yahoo/Finnhub exchange symbol.
// Overrides handle tickers whose dashboard form differs from the exchange symbol.
const SYMBOL_OVERRIDES = { 'NDB':'NDA-SE.ST', 'ASML':'ASML.AS', 'FCT':'FCT.MI', 'FIGMA':'FIG', 'RHM':'RHM.DE', 'RENK':'R3NK.DE', 'DELLIA':'DELIA.OL' };
function exSymbol(ticker, ccy){
  const t = String(ticker||'').trim().toUpperCase().replace(/\s+/g,'-');
  if(SYMBOL_OVERRIDES[t]) return SYMBOL_OVERRIDES[t];
  switch(String(ccy||'').toUpperCase()){
    case 'USD': return t;
    case 'SEK': return t + '.ST';
    case 'NOK': return t + '.OL';
    case 'DKK': return t + '.CO';
    case 'EUR': return t + '.DE';
    default:    return t;
  }
}

// Lightweight toast (created on demand, themed via CSS vars).
function toast(msg, isErr){
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._hide); t._hide = setTimeout(() => { t.className = 'toast'; }, 3400);
}

async function fetchFinnhub(symbol){
  const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(finnhubKey)}`);
  if(!r.ok) return null;
  const d = await r.json();
  return (d && typeof d.c === 'number' && d.c > 0) ? { price: d.c, pct: (typeof d.dp === 'number' ? d.dp : null) } : null;
}

// Ensure a column named `name` exists on tab `d`; append + pad rows if missing. Returns its index.
function ensurePFCol(d, name){
  let idx = d.headers.indexOf(name);
  if(idx === -1){
    d.headers.push(name); idx = d.headers.length - 1;
    d.rows.forEach(r => { while(r.length < d.headers.length) r.push(''); });
  }
  return idx;
}
// Data indices of the SMA 50/100/200 columns on tab `d` (regex on headers; -1 if absent).
function smaIdx(d){const h=d.headers;return{s50:h.findIndex(x=>/sma.?50/i.test(x)),s100:h.findIndex(x=>/sma.?100/i.test(x)),s200:h.findIndex(x=>/sma.?200/i.test(x))};}
// Copy the active timeframe's SMA triple into the visible SMA columns for one row.
function applySmaTF(d, oi){
  const row=d.rows[oi], rec=SMA_TF[String(row[2]||'')];
  if(!rec) return;
  const set = rec.mode==='3Y' ? rec.w : rec.d;
  const {s50,s100,s200}=smaIdx(d);
  if(s50>=0) row[s50]=(set&&set[0]!=null)?set[0]:'';
  if(s100>=0) row[s100]=(set&&set[1]!=null)?set[1]:'';
  if(s200>=0) row[s200]=(set&&set[2]!=null)?set[2]:'';
}
// Toggle handler (called from the per-row 1Г/3Г buttons). Switches one stock's SMA timeframe.
function setSmaTF(oi, mode){
  const d=DATA[curIdx], tk=String(d.rows[oi][2]||'');
  const rec=SMA_TF[tk]||(SMA_TF[tk]={mode:'1Y',d:null,w:null});
  rec.mode=mode;
  applySmaTF(d, oi);
  renderTable(); scheduleSave();
}
// Move column `colIdx` to just after the first header matching `afterRegex` in the display order.
function positionAfter(d, colIdx, afterRegex){
  const ord=getOrd(), afterData=d.headers.findIndex(x=>afterRegex.test(x));
  const from=ord.indexOf(colIdx); if(from<0||afterData<0) return;
  ord.splice(from,1);
  ord.splice(ord.indexOf(afterData)+1,0,colIdx);
}
// Colour the (±%) distance badge by magnitude bucket (0–10 / 11–25 / 26–50 / 51–75 / 76+).
// ord 'X' = red→yellow→gray→blue→green as distance grows; 'Y' is the reverse.
function lvlPctColor(absPct, ord){
  const X=['var(--red)','var(--yellow)','var(--text3)','#38bdf8','var(--green)'];
  const Y=['var(--green)','#38bdf8','var(--text3)','var(--yellow)','var(--red)'];
  const b=absPct<=10?0:absPct<=25?1:absPct<=50?2:absPct<=75?3:4;
  return (ord==='X'?X:Y)[b];
}
// ===== Stock chart popup (test mode) =====
// Rolling simple moving average series; out[i] is null until enough history.
function smaSeries(arr,n){const out=new Array(arr.length).fill(null);let sum=0;for(let i=0;i<arr.length;i++){sum+=arr[i];if(i>=n)sum-=arr[i-n];if(i>=n-1)out[i]=sum/n}return out}
let _chartState=null,_lwcPromise=null,_histCache={};   // history cached 5 min per symbol+range — re-renders redraw instantly
// Load TradingView Lightweight Charts from CDN once.
function loadLWC(){
  if(window.LightweightCharts) return Promise.resolve();
  if(_lwcPromise) return _lwcPromise;
  _lwcPromise=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';s.onload=res;s.onerror=()=>rej(new Error('не удалось загрузить библиотеку графика'));document.head.appendChild(s)});
  return _lwcPromise;
}
function closeStockChart(){if(_chartState&&_chartState.chart){try{_chartState.chart.remove()}catch(e){}_chartState.chart=null}const ov=document.getElementById('chartOverlay');if(ov)ov.style.display='none'}
function setChartYears(y){if(!_chartState)return;_chartState.years=y;['1','3'].forEach(n=>{const b=document.getElementById('cy'+n);if(b)b.classList.toggle('tf-on',+n===y)});drawChart()}
async function openStockChart(ticker){
  const d=DATA[curIdx],row=d.rows.find(r=>String(r[2]||'').toUpperCase()===String(ticker).toUpperCase());
  if(!row){toast('Нет данных по '+ticker,true);return}
  const ccy=rowCcy(row),name=row[1]||ticker;
  _chartState={ticker,row,ccy,name,years:1,chart:null};
  let ov=document.getElementById('chartOverlay');
  if(!ov){ov=document.createElement('div');ov.id='chartOverlay';ov.className='chart-overlay';document.body.appendChild(ov);ov.addEventListener('click',e=>{if(e.target===ov)closeStockChart()})}
  ov.innerHTML=`<div class="chart-card"><div class="chart-hd"><span><b>${name}</b> · ${ticker} ${ccy}</span><span class="chart-tools"><button class="tf-btn tf-on" id="cy1" onclick="setChartYears(1)">1Г</button><button class="tf-btn" id="cy3" onclick="setChartYears(3)">3Г</button><button class="chart-x" onclick="closeStockChart()">✕</button></span></div><div id="chartBox" class="chart-box"></div><div class="chart-legend" id="chartLegend"></div></div>`;
  ov.style.display='flex';
  drawChart();
}
// (Re)draw a price + SMA + support/resistance chart using Lightweight Charts.
// Defaults render the popup (_chartState into #chartBox); Портфель 3.0 passes its own state/ids.
async function drawChart(state=_chartState, boxId='chartBox', legendId='chartLegend'){
  const box=document.getElementById(boxId),legend=document.getElementById(legendId);
  if(!box||!state)return;
  state._boxId=boxId;
  const {row,ccy,years}=state;
  if(!PRICE_PROXY){box.textContent='PRICE_PROXY не задан';return}
  const histKey=exSymbol(row[2],ccy)+':'+(years===3?'5y':'2y');
  const hc=_histCache[histKey];
  const fromCache=hc&&Date.now()-hc.t<5*60*1000;
  if(!fromCache)box.textContent='Загрузка графика…';
  let j;
  try{
    await loadLWC();
    if(fromCache)j=hc.j;
    else{
      const r=await fetch(PRICE_PROXY+'?history='+encodeURIComponent(exSymbol(row[2],ccy))+'&range='+(years===3?'5y':'2y'));
      j=await r.json();
      if(j&&Array.isArray(j.c)&&j.c.length)_histCache[histKey]={j,t:Date.now()};
    }
  }catch(e){box.textContent='Ошибка загрузки: '+(e.message||e);return}
  if(!j||!Array.isArray(j.c)||!j.c.length){box.textContent='Нет исторических данных';return}
  if(state.chart){try{state.chart.remove()}catch(e){}state.chart=null}
  box.innerHTML='';
  const LWC=window.LightweightCharts,closes=j.c,ts=j.t||[];
  const DISP=years===3?756:252,start=Math.max(0,closes.length-DISP);
  const series=arr=>{const o=[];for(let i=start;i<arr.length;i++){const v=arr[i];if(typeof v==='number'&&isFinite(v))o.push({time:ts[i],value:Math.round(v*100)/100})}return o};
  const P=series(closes),A=series(smaSeries(closes,50)),B=series(smaSeries(closes,100)),C=series(smaSeries(closes,200));
  const dark=document.documentElement.dataset.theme==='dark';
  const txt=dark?'#e8eaed':'#1a1f2e',grd=dark?'#2a2f3a':'#e8ebf0',priceCol=dark?'#e8eaed':'#111827';
  const chart=LWC.createChart(box,{width:box.clientWidth||820,height:box.clientHeight||380,
    layout:{background:{type:'solid',color:'transparent'},textColor:txt},
    grid:{vertLines:{color:grd},horzLines:{color:grd}},
    rightPriceScale:{borderColor:grd},timeScale:{borderColor:grd},
    crosshair:{mode:LWC.CrosshairMode.Normal},
    handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},
    localization:{priceFormatter:p=>p.toFixed(2)}});
  state.chart=chart;
  const mk=(color,title,lw)=>chart.addLineSeries({color,lineWidth:lw,title,priceLineVisible:false,lastValueVisible:true});
  const ps=mk(priceCol,'Цена',2),s50=mk('#2563eb','SMA 50',1),s100=mk('#f59e0b','SMA 100',1),s200=mk('#7c3aed','SMA 200',1);
  ps.setData(P);s50.setData(A);s100.setData(B);s200.setData(C);
  const supC=DATA[curIdx].headers.indexOf('Поддержка'),resC=DATA[curIdx].headers.indexOf('Сопротивление');
  const support=supC>=0?parseFloat(row[supC]):NaN,resistance=resC>=0?parseFloat(row[resC]):NaN;
  if(isFinite(support))ps.createPriceLine({price:support,color:'#16a34a',lineWidth:1,lineStyle:LWC.LineStyle.Dashed,axisLabelVisible:true,title:'Поддержка'});
  if(isFinite(resistance))ps.createPriceLine({price:resistance,color:'#dc2626',lineWidth:1,lineStyle:LWC.LineStyle.Dashed,axisLabelVisible:true,title:'Сопротивление'});
  chart.timeScale().fitContent();
  // Legend: hovered values when the crosshair moves, last values otherwise.
  const defs=[['Цена',ps,priceCol],['SMA 50',s50,'#2563eb'],['SMA 100',s100,'#f59e0b'],['SMA 200',s200,'#7c3aed']];
  const last=[P,A,B,C].map(a=>a.length?a[a.length-1].value:null);
  const paint=vals=>{legend.innerHTML=defs.map(([l,,c],i)=>`<span class="cl-item"><i style="background:${c}"></i>${l}${vals[i]!=null?` <b>${vals[i].toFixed(2)} ${ccy}</b>`:''}</span>`).join('')};
  paint(last);
  chart.subscribeCrosshairMove(param=>{if(!param||!param.time||!param.seriesData){paint(last);return}paint(defs.map(([,s])=>{const dp=param.seriesData.get(s);return dp&&typeof dp.value==='number'?dp.value:null}))});
  if(!state._resize){state._resize=()=>{const b=document.getElementById(state._boxId);if(state.chart&&b&&b.clientWidth)state.chart.applyOptions({width:b.clientWidth})};window.addEventListener('resize',state._resize)}
}
/* ===== Портфель 3.0 — single-stock (MU) page with the v3 redesign ===== */
let pf3State={row:null,ccy:'USD',years:1,chart:null};
const pf3Fmt=(n,dec=0)=>{const v=parseFloat(n);return isFinite(v)?v.toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec}):'—'};
// $12.3B / 9.9B EUR — money formatting for fundamentals in the report currency.
const pf3Bn=(v,ccy)=>{if(!(typeof v==='number'&&isFinite(v)))return'—';const a=Math.abs(v);const s=a>=1e9?(v/1e9).toFixed(1)+'B':a>=1e6?(v/1e6).toFixed(0)+'M':Math.round(v).toLocaleString();return(!ccy||ccy==='USD')?'$'+s:s+' '+ccy};

// Fundamentals (balance / cash flow / growth) via the worker's ?fundamentals= endpoint.
// Two modes, toggled in the UI: 'annual' (последний фин. год) and 'quarter'
// (баланс на конец последнего квартала + TTM денежный поток/выручка).
// Each mode is cached in memory for the session; re-fetched at most every 6h.
let pf3Fund={period:'annual',cache:{},loading:false};
const pf3Sym=()=>{const r=pf3D().rows[pf3SelIdx()];return exSymbol(r[2],r[8])};
const pf3FundData=()=>{const c=pf3Fund.cache[pf3Fund.period];return c&&c.sym===pf3Sym()?c.data:null};
// Failures are cached too (5 min) — otherwise a ticker FMP doesn't cover would
// retry → re-render → retry in a tight loop and the card would flicker forever.
async function pf3LoadFundamentals(){
  const sym=pf3Sym(),per=pf3Fund.period,c=pf3Fund.cache[per];
  if(pf3Fund.loading)return;
  if(c&&c.sym===sym&&Date.now()-c.loaded<(c.failed?5*60*1000:6*3600*1000))return;
  pf3Fund.loading=true;
  let data=null;
  try{
    const j=await(await fetch(PRICE_PROXY+'?fundamentals='+encodeURIComponent(sym)+(per==='quarter'?'&period=quarter':''))).json();
    if(j&&typeof j==='object'&&!j.error&&(j.asOf||j.revenue!=null||j.totalDebt!=null))data=j;
  }catch(e){}
  pf3Fund.cache[per]={data,loaded:Date.now(),sym,failed:!data};
  pf3Fund.loading=false;
  if(isV3())pf3UpdateHealth();   // update only the health section — no full re-render
}
// Repaint just the «Здоровье бизнеса» section (cards, toggle state, report date).
function pf3UpdateHealth(){
  const g=document.getElementById('pf3HealthGrid');if(g)g.innerHTML=pf3Health();
  const a=document.getElementById('pf3FundAnnualBtn'),q=document.getElementById('pf3FundQuarterBtn');
  if(a)a.classList.toggle('on',pf3Fund.period==='annual');
  if(q)q.classList.toggle('on',pf3Fund.period==='quarter');
  const asof=document.getElementById('pf3FundAsof'),F=pf3FundData();
  if(asof)asof.textContent=F&&F.asOf?'отчёт от '+F.asOf:'';
}
function pf3SetFundPeriod(p){pf3Fund.period=p;pf3UpdateHealth();pf3LoadFundamentals()}

// 5-level grading: score 0–10 per dimension → Критично/Слабо/Средне/Хорошо/Отлично.
const PF3_LV=[{l:'Критично',c:'crit',e:'🔴'},{l:'Слабо',c:'weak',e:'🟠'},{l:'Средне',c:'mid',e:'🟡'},{l:'Хорошо',c:'good',e:'🟢'},{l:'Отлично',c:'exc',e:'🏆'}];
const pf3Lv=s=>s==null?null:s>=8.5?4:s>=6.5?3:s>=4.5?2:s>=2.5?1:0;
// 0–10 scores for balance / cash flow / growth + total average; null when no data.
function pf3Scores(F){
  const avg=a=>{const v=a.filter(x=>x!=null);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null};
  const de=F.debtToEquity,cr=F.currentRatio,fcf=F.freeCashFlow,ocf=F.operatingCashFlow,cagr=F.revenueCagr,yoy=F.revenueYoY,rev=F.revenue;
  const deS=de==null?null:de<0.3?10:de<0.6?8:de<1?6:de<1.5?4:de<2?2:0;
  const crS=cr==null?null:cr>2.5?10:cr>1.8?8:cr>1.3?6:cr>1?4:cr>0.8?2:0;
  let cfS=null;   // FCF margin drives the score; positive OCF with negative FCF is weak, both negative — critical
  if(ocf!=null||fcf!=null){
    if(typeof fcf==='number'&&fcf>0){const m=rev>0?fcf/rev:null;cfS=m==null?6:m>0.20?10:m>0.12?8:m>0.06?6:m>0.02?5:4}
    else cfS=(typeof ocf==='number'&&ocf>0)?3:0;
  }
  const cagrS=cagr==null?null:cagr>15?10:cagr>8?8:cagr>4?6:cagr>0?5:cagr>-5?3:0;
  const yoyS=yoy==null?null:yoy>20?10:yoy>8?8:yoy>0?6:yoy>-10?3:0;
  const balance=avg([deS,crS]),growth=avg([cagrS,cagrS,yoyS]);   // CAGR weighs double vs YoY
  return {balance,cash:cfS,growth,total:avg([balance,cfS,growth])};
}

// Earnings calendar (next report date + consensus) via the worker's ?earnings= endpoint.
// Cached in memory for the session; re-fetched at most every 6h.
let pf3Earn={data:null,loaded:0,loading:false,failed:false,sym:''};
async function pf3LoadEarnings(){
  const sym=pf3Sym();
  if(pf3Earn.loading)return;
  if(pf3Earn.sym===sym&&pf3Earn.loaded&&Date.now()-pf3Earn.loaded<(pf3Earn.failed?5*60*1000:6*3600*1000))return;
  pf3Earn.loading=true;
  let data=null;
  try{
    const j=await(await fetch(PRICE_PROXY+'?earnings='+encodeURIComponent(sym))).json();
    if(j&&(j.next||j.last))data=j;
  }catch(e){}
  pf3Earn.data=data;pf3Earn.failed=!data;pf3Earn.sym=sym;pf3Earn.loaded=Date.now();
  pf3Earn.loading=false;
  if(isV3())pf3UpdateEarn();   // update only the earnings panel — no full re-render
}
function pf3UpdateEarn(){const b=document.getElementById('pf3EarnBody');if(b)b.innerHTML=pf3Earnings()}
const PF3_MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function pf3DateRu(s){const d=new Date(s+'T00:00:00');return isNaN(d)?String(s):`${d.getDate()} ${PF3_MONTHS[d.getMonth()]} ${d.getFullYear()}`}

// «Ближайший отчёт»: date + countdown, consensus EPS / revenue, last report vs estimates.
function pf3Earnings(){
  const ok=pf3Earn.sym===pf3Sym(),E=ok?pf3Earn.data:null;
  if(!E)return`<div class="pf3-empty">${pf3Earn.loading?'Загружаю календарь отчётов…':(ok&&pf3Earn.failed)?'Нет календаря отчётов по этой бумаге (проверены FMP и Yahoo; убедитесь, что worker обновлён)':'Загрузка…'}</div>`;
  const mc=v=>v==null?'—':((!E.ccy||E.ccy==='USD')?'$':'')+(+v).toFixed(2)+(E.ccy&&E.ccy!=='USD'?' '+E.ccy:'');
  let h='';
  if(E.next){
    const days=Math.ceil((Date.parse(E.next.date)-Date.now())/86400000);
    const when=days<=0?'сегодня':days===1?'завтра':`через ${days} дн.`;
    h+=`<div class="pf3-cards" style="margin-bottom:10px">
      <div class="pf3-card"><div class="pf3-card-l">Дата отчёта</div><div class="pf3-card-v" style="font-size:17px">${pf3DateRu(E.next.date)}</div><div class="pf3-card-s">📅 ${when}</div></div>
      <div class="pf3-card"><div class="pf3-card-l">Ожидание: EPS</div><div class="pf3-card-v">${mc(E.next.epsEst)}</div><div class="pf3-card-s">консенсус аналитиков</div></div>
      <div class="pf3-card"><div class="pf3-card-l">Ожидание: выручка</div><div class="pf3-card-v">${pf3Bn(E.next.revEst,E.ccy)}</div><div class="pf3-card-s">консенсус аналитиков</div></div>
    </div>`;
  }else h+='<div class="pf3-empty">Дата следующего отчёта ещё не объявлена</div>';
  if(E.last){
    const L=E.last;
    const cmp=(a,e)=>{if(a==null||e==null||!e)return'';const p=(a-e)/Math.abs(e)*100;return` <span class="${p>=0?'pf3-up':'pf3-down'}">(${p>=0?'✅ +':'❌ '}${p.toFixed(1)}% к прогнозу)</span>`};
    const rev=L.revActual!=null?` · Выручка <b>${pf3Bn(L.revActual,E.ccy)}</b>${cmp(L.revActual,L.revEst)}`:'';
    h+=`<div class="pf3-hmetrics" style="margin-top:4px">Прошлый отчёт ${pf3DateRu(L.date)}: EPS <b>${mc(L.epsActual)}</b>${cmp(L.epsActual,L.epsEst)}${rev}</div>`;
  }
  return h;
}

// Buy / add-on levels computed from the live technicals (SMA 50/100/200 + support).
// Re-rendered on every refresh, so the ladder follows the market automatically.
function pf3BuySection(r,h,price,ccy){
  const d=pf3D();
  const {s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка');
  const raw=[['SMA 50',s50>=0?parseFloat(r[s50]):NaN],['SMA 100',s100>=0?parseFloat(r[s100]):NaN],['SMA 200',s200>=0?parseFloat(r[s200]):NaN],['Поддержка',supC>=0?parseFloat(r[supC]):NaN]].filter(([,v])=>isFinite(v)&&v>0);
  if(!raw.length||!(price>0))return'<div class="pf3-empty">Нажмите «Обновить цену» — уровни покупки рассчитаются по SMA и поддержке</div>';
  // Merge levels that sit within 1.5% of each other into one zone (e.g. SMA 100 ≈ SMA 200).
  const zones=[];
  raw.slice().sort((a,b)=>b[1]-a[1]).forEach(([n,v])=>{
    const z=zones.find(z=>Math.abs(z.val-v)/z.val<0.015);
    if(z){z.names.push(n);z.val=(z.val+v)/2;}else zones.push({names:[n],val:v});
  });
  const below=zones.filter(z=>z.val<price);            // buy zones, nearest first
  const above=zones.filter(z=>z.val>=price);
  const near=zones.find(z=>Math.abs(price-z.val)/z.val*100<=2);
  // Current signal banner.
  let sig;
  if(near)sig={cls:'buy',txt:`🟢 Цена прямо у уровня ${near.names.join(' + ')} (${pf3Fmt(near.val,2)} ${ccy}) — зона покупки сейчас`};
  else if(!below.length)sig={cls:'warn',txt:'🔴 Цена ниже всех технических уровней — нисходящий тренд, не ловите «падающий нож»'};
  else sig={cls:'wait',txt:`⏳ Цена выше уровней — выгоднее ждать отката к ${below[0].names.join(' + ')} (−${((price-below[0].val)/price*100).toFixed(1)}%)`};
  // Ladder of buy zones below the current price.
  const plans=['Первая докупка · ~25% бюджета','Основная докупка · ~35% бюджета','Крупная докупка · ~40% бюджета','Экстра-зона · только при панике рынка'];
  let rows='';
  below.forEach((z,i)=>{
    rows+=`<div class="pf3-buy"><span class="pf3-buy-n">${i+1}</span><div class="pf3-buy-info"><b>${pf3Fmt(z.val,2)} ${ccy}</b><span>${z.names.join(' + ')}</span></div><span class="pf3-buy-dist">−${((price-z.val)/price*100).toFixed(1)}%</span><span class="pf3-buy-plan">${plans[Math.min(i,plans.length-1)]}</span></div>`;
  });
  // Price under everything: the nearest level above becomes the reversal confirmation.
  if(!below.length&&above.length){
    const nx=above[above.length-1];
    rows=`<div class="pf3-empty">Возврат выше ${pf3Fmt(nx.val,2)} ${ccy} (${nx.names.join(' + ')}) подтвердит разворот — докупать безопаснее после этого</div>`;
  }
  return `<div class="pf3-signal ${sig.cls}">${sig.txt}</div>${rows}`;
}

// The three «здоровье бизнеса» cards + overall company verdict with a 0–10 scale.
function pf3Health(){
  const c=pf3Fund.cache[pf3Fund.period],F=c&&c.sym===pf3Sym()?c.data:null;
  if(!F)return`<div class="pf3-empty">${pf3Fund.loading?'Загружаю отчётность…':(c&&c.sym===pf3Sym()&&c.failed)?'Нет данных по этой бумаге (проверены FMP и Yahoo; убедитесь, что worker обновлён)':'Загрузка…'}</div>`;
  const q=F.period==='quarter';
  const S=pf3Scores(F);
  const card=(icon,title,score,metrics)=>{
    const lv=pf3Lv(score);
    const verdict=lv==null?'—':`${PF3_LV[lv].e} ${PF3_LV[lv].l} · ${score.toFixed(1)}`;
    return`<div class="pf3-hcard ${lv==null?'':PF3_LV[lv].c}"><div class="pf3-hcard-top"><span class="pf3-hcard-t">${icon} ${title}</span><span class="pf3-verdict ${lv==null?'':PF3_LV[lv].c}">${verdict}</span></div><div class="pf3-hmetrics">${metrics}</div></div>`;
  };
  const de=F.debtToEquity,cr=F.currentRatio,fcf=F.freeCashFlow,ocf=F.operatingCashFlow,cagr=F.revenueCagr,yoy=F.revenueYoY;
  const tl=pf3Lv(S.total);
  const OVERALL=['Критическое','Слабое','Среднее','Хорошее','Отличное'];
  const overall=tl==null?'':`<div class="pf3-overall">
    <div class="pf3-overall-l"><span class="pf3-overall-badge ${PF3_LV[tl].c}">${PF3_LV[tl].e} Состояние компании: ${OVERALL[tl]}</span><span class="pf3-overall-score">${S.total.toFixed(1)} / 10</span></div>
    <div class="pf3-scale"><div class="pf3-scale-marker" style="left:${Math.min(100,Math.max(0,S.total*10))}%"></div></div>
    <div class="pf3-scale-labels"><span>Критично</span><span>Слабо</span><span>Средне</span><span>Хорошо</span><span>Отлично</span></div>
  </div>`;
  const cfLbl=(q||F.source==='yahoo')?'за 12 мес (TTM)':'за фин. год';   // Yahoo's cash-flow figures are always TTM
  return overall
    +card('🏦','Устойчивый баланс',S.balance,
      `Долг/капитал <b>${de!=null?de.toFixed(2):'—'}</b> · Ликвидность <b>${cr!=null?cr.toFixed(1):'—'}</b> · Кэш <b>${pf3Bn(F.cash,F.ccy)}</b>${q?' · на конец квартала':''}`)
    +card('💵','Положительный денежный поток',S.cash,
      `Свободный CF <b>${pf3Bn(fcf,F.ccy)}</b> · Операционный CF <b>${pf3Bn(ocf,F.ccy)}</b> ${cfLbl}`)
    +card('📈','Долгосрочный рост',S.growth,
      `Выручка CAGR ${F.revenueYears||'—'} лет <b>${cagr!=null?(cagr>0?'+':'')+cagr.toFixed(1)+'%':'—'}</b> · ${q?'Квартал г/г':'Год к году'} <b>${yoy!=null?(yoy>0?'+':'')+yoy.toFixed(1)+'%':'—'}</b> · Выручка${q?' TTM':''} <b>${pf3Bn(F.revenue,F.ccy)}</b>`);
}

// ===== «AI Assistant» sub-tab: Claude-powered portfolio analysis =====
// The worker's ?action=ai endpoint sends the snapshot to the Claude API and
// returns a markdown report; the last report is stored in pf3D().aiReport
// (synced), so it survives reloads and is visible on every device.
let pf3Ai={loading:false};

// Everything the model needs: positions with live prices, levels, targets, shares + capital.
function pf3AiSnapshot(){
  const d=pf3D(),h=d.headers,{s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление'),tgC=h.findIndex(x=>/аналит/i.test(x));
  let totalVal=0;
  d.rows.forEach((r,i)=>{recalcPF(i,v3Key);totalVal+=parseFloat(r[13])||0});
  const num=v=>{const n=parseFloat(v);return isFinite(n)?n:null};
  const positions=d.rows.map(r=>({
    name:r[1],ticker:r[2],sector:r[4],ccy:r[8]||'USD',
    qty:num(r[6]),buyPrice:num(r[9]),price:num(r[7]),
    plPct:num(r[12]),valueSEK:Math.round(num(r[13])||0),
    sharePct:totalVal>0?Math.round((num(r[13])||0)/totalVal*1000)/10:0,
    sma50:s50>=0?num(r[s50]):null,sma100:s100>=0?num(r[s100]):null,sma200:s200>=0?num(r[s200]):null,
    support:supC>=0?num(r[supC]):null,resistance:resC>=0?num(r[resC]):null,
    analystTarget:tgC>=0?num(r[tgC]):null,
  }));
  // Allocation summary — the same numbers the «Состояние портфеля» tab shows.
  const group=key=>{const m={};positions.forEach(p=>{const k=p[key]||'—';m[k]=(m[k]||0)+(p.valueSEK||0)});return Object.entries(m).map(([k,v])=>({name:k,pct:totalVal>0?Math.round(v/totalVal*1000)/10:0})).sort((a,b)=>b.pct-a.pct)};
  return{
    baseCurrency:'SEK',fxToSEK:FX,positions,
    allocation:{bySector:group('sector'),byCurrency:group('ccy')},
    totals:{stocksSEK:Math.round(totalVal),freeCashSEK:num(d.cashFree)||0,leverageSEK:num(d.leverage)||0},
  };
}

// History of analyses (newest first, capped) — each entry {text, proposal, at}.
// Older d.aiReport (single report) is folded in for backward compatibility.
function pf3AiHist(){
  const d=pf3D();
  if(d.aiHistory&&d.aiHistory.length)return d.aiHistory;
  return d.aiReport?[d.aiReport]:[];
}
const pf3DtRu=iso=>{const d=new Date(iso);return isNaN(d)?'':pf3DateRu(String(iso).slice(0,10))+', '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};

async function pf3AiRun(){
  if(pf3Ai.loading)return;
  pf3Ai.loading=true;
  renderPF3();
  try{
    // Fresh prices + SMA/levels first — so the AI snapshot, the signals column
    // and the «Состояние портфеля» tab all reflect the current market state.
    await pf3Refresh(true);
    const r=await fetch(PRICE_PROXY+'?action=ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pf3AiSnapshot())});
    const j=await r.json();
    if(j&&j.text){
      const d=pf3D();
      const entry={text:j.text,proposal:j.proposal||null,at:new Date().toISOString()};
      d.aiHistory=[entry,...pf3AiHist()].slice(0,10);   // keep the last 10 runs
      delete d.aiReport;   // superseded by aiHistory
      scheduleSave();
      toast('🤖 Анализ готов — отчёт и предложение обновлены');
    }else toast((j&&j.error)||'AI не ответил',true);
  }catch(e){toast('Worker недоступен или не обновлён (нужен эндпоинт ?action=ai)',true);}
  pf3Ai.loading=false;
  if(isV3())renderPF3();
}

// Minimal markdown → HTML for the report (headings, bold, bullet/numbered lists).
function pf3Md(t){
  const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmt=s=>s.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  let html='',inList=false;
  const closeList=()=>{if(inList){html+='</ul>';inList=false}};
  esc(String(t)).split('\n').forEach(line=>{
    const l=line.trim();
    if(/^#{1,4}\s/.test(l)){closeList();html+='<h4 class="pf3-ai-h">'+fmt(l.replace(/^#+\s*/,''))+'</h4>';return}
    if(/^([-•*]|\d+[.)])\s/.test(l)){if(!inList){html+='<ul class="pf3-ai-ul">';inList=true}html+='<li>'+fmt(l.replace(/^([-•*]|\d+[.)])\s*/,''))+'</li>';return}
    if(!l){closeList();return}
    closeList();html+='<p>'+fmt(l)+'</p>';
  });
  closeList();
  return html;
}

function pf3AiHTML(){
  const H=pf3AiHist(),last=H[0];
  let h=`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🤖 AI Assistant — анализ портфеля и рекомендации</span><span class="pf3-asof">${last&&last.at?'обновлено '+pf3DtRu(last.at):''}</span></div>
    <div class="pf3-ai-bar">
      <button class="pf3-btn" onclick="pf3AiRun()" ${pf3Ai.loading?'disabled':''}>${pf3Ai.loading?'⏳ Анализирую… (30–60 сек)':'🔮 Проанализировать портфель'}</button>
      <span class="pf3-ai-note">Claude получит состав портфеля, живые цены, уровни SMA/поддержки, таргеты аналитиков и кэш — и вернёт отчёт с рекомендациями и план ребалансировки (вкладка «⚖️ Предложение»).</span>
    </div>
    ${last&&last.text?`<div class="pf3-ai-report">${pf3Md(last.text)}</div>`:(pf3Ai.loading?'':'<div class="pf3-empty">Отчёта ещё нет — нажмите «Проанализировать портфель»</div>')}
  </section>`;
  if(H.length>1){
    h+=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>📜 История запросов</span><span class="pf3-asof">${H.length-1} пред.</span></div>`;
    H.slice(1).forEach(e=>{
      h+=`<details class="pf3-ai-hist"><summary>🗓 ${pf3DtRu(e.at)}</summary><div class="pf3-ai-report" style="margin-top:10px">${pf3Md(e.text)}</div></details>`;
    });
    h+='</section>';
  }
  return h;
}

// ===== «Предложение» sub-tab: rebalancing plan from the latest AI run =====
function pf3PropHTML(){
  const H=pf3AiHist(),last=H[0],P=last&&last.proposal;
  let h=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>⚖️ Предложение по балансировке портфеля</span><span class="pf3-asof">${last&&last.at?'обновлено '+pf3DtRu(last.at):''}</span></div>`;
  if(!P){
    h+=`<div class="pf3-empty">${last?'В последнем анализе нет структурированного плана — запустите анализ заново на вкладке «🤖 AI Assistant» (worker должен быть обновлён)':'Предложения ещё нет — запустите анализ на вкладке «🤖 AI Assistant», и план ребалансировки появится здесь'}</div></section>`;
    return h;
  }
  if(P.summary)h+=`<div class="pf3-prop-sum">${pf3Md(P.summary)}</div>`;
  (P.actions||[]).forEach((a,i)=>{
    const cls=/куп/i.test(a.action)?'buy':/прода|сократ/i.test(a.action)?'sell':'hold';
    h+=`<div class="pf3-prop-row">
      <span class="pf3-prop-n">${i+1}</span>
      <span class="pf3-prop-act ${cls}">${a.action||''}</span>
      <div class="pf3-prop-info"><b>${a.name||''} <span class="pf3-cal-tk">${a.ticker||''}</span></b><span>${a.details||''}</span></div>
      <span class="pf3-prop-amt">${typeof a.amountSEK==='number'&&a.amountSEK>0?'≈'+pf3Fmt(a.amountSEK)+' kr':''}</span>
    </div>`;
  });
  h+='</section>';
  return h;
}

// ===== «Состояние портфеля» sub-tab: client-side health analysis =====
// Five dimensions scored 0–10 (diversification, sectors, currencies, cash &
// leverage, trend & quality) + overall verdict, allocations and recommendations.
function pf3HealthTab(){
  const d=pf3D(),{s200}=smaIdx(d);
  const free=parseFloat(d.cashFree)||0,lev=parseFloat(d.leverage)||0;
  const rows=d.rows.map((r,i)=>{
    recalcPF(i,v3Key);
    const price=parseFloat(r[7])||0,sma=s200>=0?parseFloat(r[s200]):NaN;
    return{
      name:String(r[1]||r[2]||''),
      val:parseFloat(r[13])||0,profit:parseFloat(r[11])||0,
      sec:(r[4]&&r[4]!=='—')?String(r[4]):'Прочее',
      ccy:r[8]||'USD',
      above:(isFinite(sma)&&sma>0&&price>0)?price>sma:null,
    };
  }).filter(x=>x.val>0);
  if(!rows.length)return'<section class="pf3-panel"><div class="pf3-empty">Нет позиций для анализа — обновите цены на вкладке «Портфель»</div></section>';
  const totalVal=rows.reduce((a,x)=>a+x.val,0);
  const equity=totalVal+free;
  // Concentration.
  const sorted=rows.slice().sort((a,b)=>b.val-a.val);
  const top1=sorted[0],top1Pct=top1.val/totalVal*100;
  const top3Pct=sorted.slice(0,3).reduce((a,x)=>a+x.val,0)/totalVal*100;
  // Allocations.
  const group=key=>{const m={};rows.forEach(x=>{m[x[key]]=(m[x[key]]||0)+x.val});return Object.entries(m).map(([k,v])=>({k,pct:v/totalVal*100})).sort((a,b)=>b.pct-a.pct)};
  const secs=group('sec'),ccys=group('ccy');
  // Trend & quality.
  const withSma=rows.filter(x=>x.above!=null);
  const abovePct=withSma.length?withSma.filter(x=>x.above).length/withSma.length*100:null;
  const profitPct=rows.filter(x=>x.profit>0).length/rows.length*100;
  const cashPct=equity>0?free/equity*100:0;
  const levPct=equity>0?lev/equity*100:0;
  // Scores 0–10 per dimension.
  const dn=(v,b)=>{for(const[lim,sc]of b)if(v<lim)return sc;return 0};        // lower is better
  const up=v=>v>=70?10:v>=55?8:v>=40?6:v>=25?4:2;                              // higher is better
  const nS=rows.length>=15?10:rows.length>=10?8:rows.length>=7?6:rows.length>=5?4:2;
  const divS=(nS+dn(top1Pct,[[10,10],[15,8],[20,6],[30,4],[40,2]]))/2;
  const secS=(dn(secs[0].pct,[[20,10],[30,8],[40,6],[50,4],[60,2]])+(secs.length>=6?10:secs.length>=4?7:secs.length>=3?5:3))/2;
  const ccyS=dn(ccys[0].pct,[[50,10],[65,8],[80,6],[90,4],[101,2]]);
  const cashS=(cashPct>=5&&cashPct<=25)?10:(cashPct>=2&&cashPct<40)?6:cashPct>=40?5:3;
  const levS=lev<=0?10:dn(levPct,[[10,8],[20,6],[35,4],[1e9,2]]);
  const liqS=(cashS+levS)/2;
  const trS=abovePct==null?null:(up(abovePct)+up(profitPct))/2;
  const parts=[
    ['🧩 Диверсификация',divS,`${rows.length} позиций · топ-1 <b>${top1Pct.toFixed(1)}%</b> (${top1.name}) · топ-3 <b>${top3Pct.toFixed(0)}%</b>`],
    ['🏭 Сектора',secS,`${secs.length} секторов · крупнейший <b>${secs[0].k}</b> — <b>${secs[0].pct.toFixed(0)}%</b>`],
    ['💱 Валюты',ccyS,ccys.slice(0,4).map(c=>`${c.k} <b>${c.pct.toFixed(0)}%</b>`).join(' · ')],
    ['💵 Кэш и плечо',liqS,`кэш <b>${cashPct.toFixed(1)}%</b> капитала · плечо <b>${levPct.toFixed(1)}%</b>`],
    ['📈 Тренд и качество',trS,`выше SMA 200: <b>${abovePct!=null?abovePct.toFixed(0)+'%':'—'}</b> акций · в прибыли: <b>${profitPct.toFixed(0)}%</b> позиций`],
  ];
  const valid=parts.filter(p=>p[1]!=null);
  const total=valid.reduce((a,p)=>a+p[1],0)/(valid.length||1);
  const tl=pf3Lv(total);
  const OVERALL=['Критическое','Слабое','Среднее','Хорошее','Отличное'];
  // Plain-language recommendations from the weak spots.
  const rec=[];
  if(top1Pct>20)rec.push(`⚠️ <b>${top1.name}</b> занимает ${top1Pct.toFixed(0)}% портфеля — рассмотрите сокращение до 15–20%, чтобы снизить риск одной бумаги`);
  if(secs[0].pct>40)rec.push(`⚠️ Сектор «<b>${secs[0].k}</b>» — ${secs[0].pct.toFixed(0)}% акций: высокая отраслевая концентрация`);
  if(ccys[0].pct>80)rec.push(`⚠️ ${ccys[0].pct.toFixed(0)}% портфеля в <b>${ccys[0].k}</b> — заметный валютный риск для кроновых целей`);
  if(cashPct>30)rec.push(`💡 Кэш ${cashPct.toFixed(0)}% капитала — большой резерв: размещайте его постепенно по сигналам докупки на вкладке «Портфель»`);
  if(cashPct<3)rec.push('⚠️ Свободного кэша почти нет — нечем докупать на просадках');
  if(levPct>20)rec.push(`⚠️ Плечо ${levPct.toFixed(0)}% капитала — следите за стоимостью заёмных средств`);
  if(abovePct!=null&&abovePct<40)rec.push('⚠️ Большинство акций ниже SMA 200 — портфель в нисходящем тренде, докупайте осторожно');
  if(rows.length<8)rec.push('💡 Меньше 8 позиций — 3–5 бумаг из недостающих секторов снизят риск');
  if(!rec.length)rec.push('✅ Существенных перекосов не найдено — портфель сбалансирован');
  const bars=arr=>arr.slice(0,8).map(x=>`<div class="pf3-bar-row"><span class="pf3-bar-l">${x.k}</span><div class="pf3-bar-track"><div class="pf3-bar-fill" style="width:${Math.min(100,x.pct)}%"></div></div><span class="pf3-bar-v">${x.pct.toFixed(1)}%</span></div>`).join('');
  const card=(t,score,metrics)=>{
    const lv=pf3Lv(score);
    const verdict=lv==null?'—':`${PF3_LV[lv].e} ${PF3_LV[lv].l} · ${score.toFixed(1)}`;
    return`<div class="pf3-hcard ${lv==null?'':PF3_LV[lv].c}"><div class="pf3-hcard-top"><span class="pf3-hcard-t">${t}</span><span class="pf3-verdict ${lv==null?'':PF3_LV[lv].c}">${verdict}</span></div><div class="pf3-hmetrics">${metrics}</div></div>`;
  };
  return`
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🩺 Состояние портфеля</span></div>
    <div class="pf3-health-grid">
      ${tl!=null?`<div class="pf3-overall">
        <div class="pf3-overall-l"><span class="pf3-overall-badge ${PF3_LV[tl].c}">${PF3_LV[tl].e} Здоровье портфеля: ${OVERALL[tl]}</span><span class="pf3-overall-score">${total.toFixed(1)} / 10</span></div>
        <div class="pf3-scale"><div class="pf3-scale-marker" style="left:${Math.min(100,Math.max(0,total*10))}%"></div></div>
        <div class="pf3-scale-labels"><span>Критично</span><span>Слабо</span><span>Средне</span><span>Хорошо</span><span>Отлично</span></div>
      </div>`:''}
      ${parts.map(p=>card(p[0],p[1],p[2])).join('')}
    </div>
  </section>
  <section class="pf3-grid">
    <div class="pf3-panel"><div class="pf3-panel-hd"><span>🏭 Распределение по секторам</span></div>${bars(secs)}</div>
    <div class="pf3-panel"><div class="pf3-panel-hd"><span>💱 Распределение по валютам</span></div>${bars(ccys)}</div>
  </section>
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>💡 Рекомендации</span></div>
    ${rec.map(r=>`<div class="pf3-reco">${r}</div>`).join('')}
  </section>`;
}

// Portfolio summary strip: total value (stocks + cash), profit, editable free
// cash (stored in pf3D().cash, synced) and live exchange rates.
function pf3Summary(){
  const d=pf3D();
  let totalVal=0,totalProfit=0;
  d.rows.forEach((r,i)=>{recalcPF(i,v3Key);totalVal+=parseFloat(r[13])||0;totalProfit+=parseFloat(r[11])||0});
  const cost=totalVal-totalProfit;
  const pct=cost>0?totalProfit/cost*100:0;
  const free=parseFloat(d.cashFree)||0,lev=parseFloat(d.leverage)||0;
  const equity=totalVal+free;   // чистый капитал: акции + свободный кэш
  const withLev=equity+lev;     // покупательная способность с кредитным плечом
  const num=(key,val,cls)=>`<input class="pf3-cash-input${cls?' '+cls:''}" type="number" step="any" min="0" value="${val}" onchange="pf3SetNum('${key}',this.value)" title="Нажмите, чтобы изменить">`;
  const fxChip=c=>typeof FX[c]==='number'?`<span class="pf3-chip">1 ${c} = <b>${(+FX[c]).toFixed(2)}</b> kr</span>`:'';
  return`<section class="pf3-summary">
    <div class="pf3-card pf3-sum-hero"><div class="pf3-card-l">Чистый капитал</div><div class="pf3-card-v">${pf3Fmt(equity)} kr</div><div class="pf3-card-s">акции + свободный кэш</div></div>
    <div class="pf3-card"><div class="pf3-card-l">Акции</div><div class="pf3-card-v">${pf3Fmt(totalVal)} kr</div><div class="pf3-card-s">${d.rows.length} позиций · ${equity>0?(totalVal/equity*100).toFixed(1):'—'}%</div></div>
    <div class="pf3-card"><div class="pf3-card-l">Прибыль</div><div class="pf3-card-v ${totalProfit>=0?'pf3-up':'pf3-down'}">${totalProfit>0?'+':''}${pf3Fmt(totalProfit)} kr</div><div class="pf3-card-s ${pct>=0?'pf3-up':'pf3-down'}">${pct>0?'+':''}${pct.toFixed(1)}% от вложений</div></div>
    <div class="pf3-card"><div class="pf3-card-l">Свободный кэш</div><div class="pf3-card-v">${num('cashFree',free)} <small>kr</small></div><div class="pf3-card-s">${equity>0&&free>0?(free/equity*100).toFixed(1)+'% капитала · доступно для покупок':'нажмите, чтобы изменить'}</div></div>
    <div class="pf3-card"><div class="pf3-card-l">Кредитное плечо</div><div class="pf3-card-v">${lev>0?'+':''}${num('leverage',lev)} <small>kr</small></div><div class="pf3-card-s">доступный кредит сверх капитала</div></div>
    <div class="pf3-card"><div class="pf3-card-l">Доступно с плечом</div><div class="pf3-card-v">${pf3Fmt(withLev)} kr</div><div class="pf3-card-s">капитал + кредитное плечо</div></div>
  </section>
  <div class="pf3-fx"><span class="pf3-fx-l">💱 Курсы</span>${fxChip('USD')+fxChip('EUR')+fxChip('NOK')+fxChip('DKK')}<span class="pf3-fx-note">живые курсы ECB · база SEK</span></div>`;
}
function pf3SetNum(key,v){const n=parseFloat(v);pf3D()[key]=(isNaN(n)||n<0)?0:n;scheduleSave();renderPF3()}

// Master-detail: the holdings list shows brief info; clicking a row opens the
// full card to the LEFT of the list, and the list scales down into a compact column.
let pf3Sel=null;   // ticker whose full card is open (null = list only)
let pf3Tab='list'; // sub-tab: 'list' (портфель) | 'cal' (дивиденды и отчёты)

// ===== «Дивиденды и отчёты» sub-tab =====
// Batch calendar (next earnings date + dividend info per holding) via ?calendar=.
let pf3Cal={data:null,loaded:0,loading:false,failed:false};
async function pf3LoadCalendar(){
  if(pf3Cal.loading||(pf3Cal.data&&pf3Cal.key===v3Key&&Date.now()-pf3Cal.loaded<6*3600*1000))return;
  pf3Cal.loading=true;pf3Cal.failed=false;
  try{
    const d=pf3D();
    const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
    const j={};   // chunked — Nasdaq has ~100 tickers, Cloudflare caps subrequests
    for(let i=0;i<syms.length;i+=40){
      const part=await(await fetch(PRICE_PROXY+'?calendar='+encodeURIComponent(syms.slice(i,i+40).join(',')))).json();
      if(part&&typeof part==='object'&&!part.error)Object.assign(j,part);
    }
    if(Object.keys(j).length){pf3Cal.data=j;pf3Cal.loaded=Date.now();pf3Cal.key=v3Key;}
    else pf3Cal.failed=true;
  }catch(e){pf3Cal.failed=true;}
  pf3Cal.loading=false;
  if(isV3()&&pf3Tab==='cal')renderPF3();
}

function pf3CalendarHTML(){
  const d=pf3D(),C=pf3Cal.key===v3Key?pf3Cal.data:null;
  if(!C)return`<section class="pf3-panel"><div class="pf3-empty">${pf3Cal.loading?'Загружаю календарь отчётов и дивидендов…':pf3Cal.failed?'Нет данных — обновите Cloudflare worker (эндпоинт ?calendar)':'Загрузка…'}</div></section>`;
  const days=s=>Math.ceil((Date.parse(s)-Date.now())/86400000);
  const er=[],dv=[];
  let annualDiv=0;
  d.rows.forEach(r=>{
    const tk=String(r[2]||''),c=C[exSymbol(r[2],r[8])]||{};
    const ccy=r[8]||'USD',qty=parseFloat(r[6])||0;
    if(c.earnings)er.push({tk,name:r[1]||tk,date:c.earnings});
    if(typeof c.divRate==='number'&&c.divRate>0){
      const annual=qty*c.divRate*(FX[ccy]||1);
      annualDiv+=annual;
      dv.push({tk,name:r[1]||tk,rate:c.divRate,ccy,yld:typeof c.divYield==='number'?c.divYield*100:null,exDiv:c.exDiv,pay:c.payDate,annual});
    }
  });
  er.sort((a,b)=>a.date<b.date?-1:1);
  dv.sort((a,b)=>(a.exDiv||'9999')<(b.exDiv||'9999')?-1:1);
  let h='<section class="pf3-panel"><div class="pf3-panel-hd"><span>📅 Квартальные отчёты — календарь</span></div>';
  if(er.length){
    h+='<div class="pf3-cal-grid">';
    er.forEach(e=>{
      const dd=days(e.date);
      const soon=isFinite(dd)&&dd>=0&&dd<=7;
      h+=`<div class="pf3-cal-row${soon?' soon':''}"><b>${e.name} <span class="pf3-cal-tk">${e.tk}</span></b><span class="pf3-cal-date">${pf3DateRu(e.date)}</span><span class="pf3-cal-days${soon?' pf3-down':''}">${!isFinite(dd)?'':dd<0?'прошёл':dd===0?'📣 сегодня':dd===1?'📣 завтра':'через '+dd+' дн.'}</span></div>`;
    });
    h+='</div>';
  }else h+='<div class="pf3-empty">Дат отчётов пока нет</div>';
  h+='</section>';
  h+=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>💰 Дивиденды</span><span class="pf3-asof">≈${pf3Fmt(annualDiv)} kr/год по текущим позициям</span></div>`;
  if(dv.length){
    h+='<div class="pf3-divhead"><span>Компания</span><span>Дивид./год</span><span>Доходность</span><span>Экс-дата</span><span>Выплата</span><span>Мне в год</span></div>';
    dv.forEach(x=>{
      h+=`<div class="pf3-div-row"><b>${x.name} <span class="pf3-cal-tk">${x.tk}</span></b><span>${x.rate.toFixed(2)} ${x.ccy}</span><span class="pf3-up">${x.yld!=null?x.yld.toFixed(1)+'%':'—'}</span><span>${x.exDiv?pf3DateRu(x.exDiv):'—'}</span><span>${x.pay?pf3DateRu(x.pay):'—'}</span><span><b>${pf3Fmt(x.annual)} kr</b></span></div>`;
    });
  }else h+='<div class="pf3-empty">Дивидендных бумаг в портфеле нет</div>';
  h+='</section>';
  return h;
}
const pf3SelIdx=()=>{const d=pf3D(),i=d.rows.findIndex(r=>String(r[2]||'')===pf3Sel);return i>=0?i:0};
function pf3Select(tk){
  pf3Sel=(pf3Sel===tk?null:tk);
  // Clicking a stock inside «Сектора»/«Тип» opens its card in the list view.
  if(pf3Sel&&(pf3Tab==='sec'||pf3Tab==='typ')){pf3Tab='list';renderAll();return}
  renderPF3();
}

// Compact buy/sell signal for the list: which technical level the price sits near.
// ±2% of SMA/support → buy (докупка), ±2% of resistance → sell; otherwise the
// nearest buy level below with its distance. Mirrors the card's «Уровни покупки».
function pf3RowSignal(d,r){
  const h=d.headers,{s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление');
  const price=parseFloat(r[7])||0;
  const lv=[['SMA 50',s50,'buy'],['SMA 100',s100,'buy'],['SMA 200',s200,'buy'],['Поддержка',supC,'buy'],['Сопр.',resC,'sell']]
    .map(([n,i,t])=>({n,t,v:i>=0?parseFloat(r[i]):NaN}))
    .filter(x=>isFinite(x.v)&&x.v>0);
  if(!(price>0)||!lv.length)return'<span class="pf3-sig pf3-sig-none">—</span>';
  let best=null;
  lv.forEach(x=>{const dist=(price-x.v)/x.v*100;if(!best||Math.abs(dist)<Math.abs(best.dist))best={...x,dist}});
  const sgn=v=>`${v>=0?'+':'−'}${Math.abs(v).toFixed(1)}%`;
  if(Math.abs(best.dist)<=2){
    if(best.t==='sell')return`<span class="pf3-sig pf3-sig-sell">🔴 Продажа · ${best.n} ${sgn(best.dist)}</span>`;
    return`<span class="pf3-sig pf3-sig-buy">🟢 ${(parseFloat(r[6])||0)>0?'Докупка':'Покупка'} · ${best.n} ${sgn(best.dist)}</span>`;
  }
  const below=lv.filter(x=>x.t==='buy'&&x.v<price).sort((a,b)=>b.v-a.v)[0];
  if(below)return`<span class="pf3-sig pf3-sig-wait">⏳ ${below.n} −${((price-below.v)/price*100).toFixed(1)}%</span>`;
  return'<span class="pf3-sig pf3-sig-warn">🔻 ниже уровней</span>';
}

// Market-phase criterion — one badge per stock, technical + fundamental:
// 🔪 падающий нож (below all SMAs on a sharp drop / broken support),
// 🌡 перегрев (price above the analyst consensus target or ≥30% over SMA 200),
// 🚀 импульс (strong day move with trend support), 💎 недооценка (≥25% upside
// to target), then trend phases: аптренд / коррекция / разворот / даунтренд.
// rank orders the phases bearish→bullish so the column sorts meaningfully.
function pf3Criterion(d,r){
  const h=d.headers,{s50,s100,s200}=smaIdx(d);
  const g=i=>i>=0?(parseFloat(r[i])||0):0;
  const p=parseFloat(r[7])||0,day=parseFloat(r[10])||0;
  const a50=g(s50),a100=g(s100),a200=g(s200),sup=g(h.indexOf('Поддержка'));
  const tg=g(h.findIndex(x=>/аналит/i.test(x)));
  const B=(rank,cls,ico,label)=>({rank,html:`<span class="pf3-crit ${cls}">${ico} ${label}</span>`});
  if(!(p>0)||!(a50>0)||!(a200>0))return{rank:3,html:'<span class="pf3-crit flat">—</span>'};
  const upTg=tg>0?(tg-p)/p*100:null;
  const belowAll=p<a50&&(!(a100>0)||p<a100)&&p<a200;
  const aboveAll=p>a50&&(!(a100>0)||p>a100)&&p>a200;
  if(belowAll&&(day<=-3||(sup>0&&p<sup)))return B(0,'knife','🔪','Падающий нож');
  if(upTg!==null&&upTg<=-5)return B(8,'heat','🌡','Перегрев');
  if(aboveAll&&p>a200*1.3)return B(8,'heat','🌡','Перегрев');
  if((day>=2.5&&p>a50)||day>=4)return B(7,'imp','🚀','Импульс');
  if(upTg!==null&&upTg>=25&&!belowAll)return B(5,'undr','💎','Недооценка');
  if(aboveAll)return B(6,'up','📈','Аптренд');
  if(belowAll)return B(1,'down','📉','Даунтренд');
  if(p<a50&&p>=a200)return B(2,'corr','⚠️','Коррекция');
  if(p>=a50&&p<a200)return B(4,'rev','🔄','Разворот');
  return B(3,'flat','⚖️','Боковик');
}

// Column sorting (display only — the underlying rows stay in place).
let pf3Sort={key:'val',dir:-1};   // default: по общей стоимости, по убыванию
function pf3SortBy(k){
  if(pf3Sort.key===k)pf3Sort.dir=-pf3Sort.dir;
  else pf3Sort={key:k,dir:(k==='name'||k==='sec')?1:-1};   // text asc, numbers desc by default
  renderPF3();
}
function pf3ListHead(){
  const ar=k=>pf3Sort.key===k?(pf3Sort.dir>0?' ▲':' ▼'):'';
  const hd=(label,key,cls,right)=>`<span class="pf3-sort${cls?' '+cls:''}"${right?' style="text-align:right"':''} onclick="pf3SortBy('${key}')">${label}${ar(key)}</span>`;
  if(v3Key!==PF3_KEY)   // index mode (Nasdaq 100): no position economics, but day % and analyst target
    return`<div class="pf3-lhead idx"><span></span>${hd('Компания','name')}${hd('Сектор','sec','pf3-c-sec')}${hd('Тип','typ','pf3-c-typ')}${hd('Цена','price','',1)}${hd('1д %','day','pf3-c-day',1)}${hd('Таргет','tg','pf3-c-tg',1)}${hd('Критерий','crit','pf3-c-crit')}<span class="pf3-c-sig">Сигнал</span><span></span></div>`;
  return`<div class="pf3-lhead"><span></span>${hd('Компания','name')}${hd('Сектор','sec','pf3-c-sec')}${hd('Тип','typ','pf3-c-typ')}${hd('Кол-во','qty','pf3-c-qty')}${hd('Покупка','buy','pf3-c-buy')}${hd('Цена','price','',1)}${hd('Стоимость','val','',1)}${hd('Доля','share','pf3-c-share',1)}${hd('Критерий','crit','pf3-c-crit')}<span class="pf3-c-sig">Сигнал</span><span></span></div>`;
}

// Rows with computed metrics + total stock value — shared by the flat list
// and the grouped «Сектора»/«Тип» views.
function pf3Items(){
  const d=pf3D();
  const tgC=d.headers.findIndex(x=>/аналит/i.test(x));
  const items=d.rows.map((r,i)=>{
    recalcPF(i,v3Key);
    const c=pf3Criterion(d,r);
    return{r,name:String(r[1]||r[2]||''),sec:String(r[4]||''),typ:String(r[5]||''),qty:parseFloat(r[6])||0,buy:parseFloat(r[9])||0,price:parseFloat(r[7])||0,val:parseFloat(r[13])||0,tg:tgC>=0?(parseFloat(r[tgC])||0):0,day:parseFloat(r[10])||0,crit:c.rank,critHtml:c.html};
  });
  const totalVal=items.reduce((a,x)=>a+x.val,0);
  items.forEach(x=>x.share=totalVal>0?x.val/totalVal*100:0);
  return{items,totalVal};
}

// One list row: logo, flag+name+ticker, sector, type, … , signal, delete.
// Index mode swaps the position columns for day % and the analyst target.
function pf3RowHTML(d,it,port){
  const {r,name,qty,buy,price,val,share,tg}=it;
  const tk=String(r[2]||''),ccy=r[8]||'USD';
  const day=parseFloat(r[10]),ppct=parseFloat(r[12])||0;
  const flag=r[3]&&r[3]!=='—'?r[3]+' ':'';
  const cells=port
    ?`<div class="pf3-c pf3-c-qty">${pf3Fmt(qty)}</div>
    <div class="pf3-c pf3-c-buy">${buy>0?pf3Fmt(buy,2):'—'}</div>
    <div class="pf3-row-price"><b>${price>0?pf3Fmt(price,2):'—'} ${ccy}</b>${isFinite(day)?`<span class="${day>=0?'pf3-up':'pf3-down'}">${day>0?'+':''}${day.toFixed(2)}%</span>`:''}</div>
    <div class="pf3-row-val"><b>${pf3Fmt(val)} kr</b><span class="${ppct>=0?'pf3-up':'pf3-down'}">${ppct>0?'+':''}${ppct.toFixed(1)}%</span></div>
    <div class="pf3-c pf3-c-share">${share>0?share.toFixed(1)+'%':'—'}</div>`
    :`<div class="pf3-row-price"><b>${price>0?pf3Fmt(price,2):'—'} ${ccy}</b></div>
    <div class="pf3-c pf3-c-day"><span class="${day>=0?'pf3-up':'pf3-down'}">${isFinite(day)?(day>0?'+':'')+day.toFixed(2)+'%':'—'}</span></div>
    <div class="pf3-row-price pf3-c-tg"><b>${tg>0?pf3Fmt(tg,0):'—'}</b>${tg>0&&price>0?`<span class="${tg>=price?'pf3-up':'pf3-down'}">${tg>=price?'+':''}${((tg-price)/price*100).toFixed(0)}%</span>`:''}</div>`;
  return`<div class="pf3-row${port?'':' idx'}${pf3Sel===tk?' active':''}" onclick="pf3Select('${tk}')">
    <div class="pf3-row-logo">${tk.slice(0,2)}</div>
    <div class="pf3-row-name"><b>${flag}${name||tk}</b><span>${tk}</span></div>
    <div class="pf3-c pf3-c-sec">${r[4]&&r[4]!=='—'?r[4]:'—'}</div>
    <div class="pf3-c pf3-c-typ"><span class="pf3-typ${PF3_TYPE_META[r[5]]?' '+PF3_TYPE_META[r[5]][1]:''}">${PF3_TYPE_META[r[5]]?PF3_TYPE_META[r[5]][0]+' ':''}${r[5]&&r[5]!=='—'?r[5]:'—'}</span></div>
    ${cells}
    <div class="pf3-c pf3-c-crit">${it.critHtml||''}</div>
    <div class="pf3-c pf3-c-sig">${pf3RowSignal(d,r)}</div>
    <div class="pf3-row-act"><button class="pf3-del" onclick="pf3Delete('${tk}',event)" title="Удалить акцию">🗑</button><span class="pf3-row-arr">${pf3Sel===tk?'✕':'›'}</span></div>
  </div>`;
}

function pf3ListHTML(){
  const d=pf3D(),port=v3Key===PF3_KEY;
  const {items}=pf3Items();
  const k=pf3Sort.key,dir=pf3Sort.dir;
  items.sort((a,b)=>{const x=a[k],y=b[k];return(typeof x==='string'?x.localeCompare(y,'ru'):x-y)*dir});
  return items.map(it=>pf3RowHTML(d,it,port)).join('');
}

// «Сектора» / «Тип» sub-tabs. Sectors: stacked panels per group. Types: a
// sidebar with the type list on the left; clicking a type shows its stocks
// on the right (the largest type is selected by default).
let pf3TypeSel=null;
function pf3TypeSelect(g){pf3TypeSel=g;renderPF3()}
function pf3Groups(key){
  const d=pf3D(),port=v3Key===PF3_KEY;
  const {items,totalVal}=pf3Items();
  const groups={};
  items.forEach(it=>{
    const g=(key==='sec'?it.sec:it.typ);
    const name=g&&g!=='—'?g:'Прочее';
    (groups[name]=groups[name]||[]).push(it);
  });
  const list=Object.entries(groups).map(([g,arr])=>({g,arr,val:arr.reduce((a,x)=>a+x.val,0)}));
  list.sort((a,b)=>port?b.val-a.val:b.arr.length-a.arr.length);
  list.forEach(x=>x.arr.sort((a,b)=>port?b.val-a.val:b.day-a.day));
  return {d,port,totalVal,list};
}
function pf3GroupSub(x,port,totalVal){
  const avgDay=x.arr.reduce((a,it)=>a+it.day,0)/x.arr.length;
  return port
    ?`${x.arr.length} акц. · ${pf3Fmt(x.val)} kr · ${totalVal>0?(x.val/totalVal*100).toFixed(1):'0'}% портфеля`
    :`${x.arr.length} акц. · ср. за день ${(avgDay>0?'+':'')+avgDay.toFixed(2)}%`;
}
function pf3GroupedHTML(key){
  const {d,port,totalVal,list}=pf3Groups(key);
  if(!list.length)return '<section class="pf3-panel"><div class="pf3-empty">Нет данных</div></section>';
  if(key==='typ'){
    const sel=list.find(x=>x.g===pf3TypeSel)||list[0];
    const nav=list.map(x=>{
      const m=PF3_TYPE_META[x.g];
      return`<div class="pf3-typenav-it${x.g===sel.g?' active':''}" onclick="pf3TypeSelect('${x.g.replace(/'/g,"\\'")}')">
        <span class="pf3-typenav-ico">${m?m[0]:'🏷'}</span>
        <span class="pf3-typenav-name">${x.g}<small>${port?pf3Fmt(x.val)+' kr · '+(totalVal>0?(x.val/totalVal*100).toFixed(1):'0')+'%':x.arr.length+' акц.'}</small></span>
        <span class="pf3-typenav-cnt">${x.arr.length}</span>
      </div>`;
    }).join('');
    const m=PF3_TYPE_META[sel.g];
    return`<div class="pf3-typelay">
      <aside class="pf3-panel pf3-typenav"><div class="pf3-panel-hd"><span>Типы</span></div>${nav}</aside>
      <section class="pf3-panel"><div class="pf3-panel-hd"><span>${m?m[0]:'🏷'} ${sel.g}</span><span class="pf3-asof">${pf3GroupSub(sel,port,totalVal)}</span></div><div class="pf3-glist">${sel.arr.map(it=>pf3RowHTML(d,it,port)).join('')}</div></section>
    </div>`;
  }
  return list.map(x=>`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🏭 ${x.g}</span><span class="pf3-asof">${pf3GroupSub(x,port,totalVal)}</span></div><div class="pf3-glist">${x.arr.map(it=>pf3RowHTML(d,it,port)).join('')}</div></section>`).join('');
}

// Add a stock to Портфель 3.0 (form at the bottom of the list).
function pf3Add(e){
  if(e)e.preventDefault();
  const t=document.getElementById('pf3AddTicker').value.trim().toUpperCase();
  const sh=parseFloat(document.getElementById('pf3AddQty').value);
  const buy=parseFloat(document.getElementById('pf3AddBuy').value);
  const ccy=document.getElementById('pf3AddCcy').value;
  if(!t||!(sh>0)||!(buy>0)){toast('Заполните тикер, кол-во и цену покупки',true);return}
  const d=pf3D();
  if(d.rows.some(r=>String(r[2]||'').trim().toUpperCase()===t)){toast(t+' уже в списке',true);return}
  const flag={USD:'🇺🇸',EUR:'🇪🇺',SEK:'🇸🇪',NOK:'🇳🇴',DKK:'🇩🇰'}[ccy]||'';
  const row=[d.rows.length+1,PF3_NAMES[t]||t,t,flag,'—','Акция',sh,buy,ccy,buy,0,0,0,0,'—','—','','','',0,0,'⚪ Держать'];
  while(row.length<d.headers.length)row.push('');
  d.rows.push(row);
  d.count=d.rows.length;
  if(d.removed)d.removed=d.removed.filter(x=>x!==t);   // re-adding cancels an earlier delete
  recalcPF(d.rows.length-1,v3Key);
  scheduleSave();
  init();   // rebuild tabs (count badge) + re-render
  toast(t+' добавлен');
  pf3Refresh(true);     // pull the live price / levels for the new stock
  pf3FillProfile(t);    // auto-fill the company name + sector from Yahoo
}

// Auto-fill name/sector for a freshly added ticker via the worker's ?profile= endpoint.
const PF3_SECTOR_RU={'Technology':'Технологии','Healthcare':'Здравоохранение','Financial Services':'Финансы','Consumer Cyclical':'Потребительский','Consumer Defensive':'Потребительские товары','Industrials':'Промышленность','Energy':'Энергетика','Utilities':'Коммунальные услуги','Real Estate':'Недвижимость','Communication Services':'Коммуникации','Basic Materials':'Материалы'};
async function pf3FillProfile(tk){
  try{
    const d=pf3D(),r=d.rows.find(x=>String(x[2]||'').trim().toUpperCase()===tk);
    if(!r)return;
    const p=await(await fetch(PRICE_PROXY+'?profile='+encodeURIComponent(exSymbol(r[2],r[8])))).json();
    if(!p||typeof p!=='object')return;
    let ch=false;
    if(p.name&&(!r[1]||String(r[1]).trim().toUpperCase()===tk)){r[1]=p.name;ch=true;}
    if(p.sector&&(!r[4]||r[4]==='—')){r[4]=PF3_SECTOR_RU[p.sector]||p.sector;ch=true;}
    // Instrument type: ETF/fund by Yahoo quoteType, REIT→Дивидендная by industry, else by sector.
    const typ=p.type==='ETF'?'ETF':p.type==='MUTUALFUND'?'Фонд'
      :/reit/i.test(p.industry||'')?'Дивидендная'
      :pf3DeriveType(tk,String(p.sector||r[4]||''),'');
    if(r[5]!==typ){r[5]=typ;ch=true;}
    if(ch){scheduleSave();if(isV3())renderPF3();}
  }catch(e){}
}

// Delete a stock from Портфель 3.0. Remembered in d.removed so the 2.0 sync
// migration doesn't immediately re-import it.
function pf3Delete(tk,ev){
  if(ev)ev.stopPropagation();
  const d=pf3D(),i=d.rows.findIndex(r=>String(r[2]||'')===tk);
  if(i<0)return;
  if(!confirm('Удалить '+tk+' из Портфеля 3.0?'))return;
  d.rows.splice(i,1);
  d.rows.forEach((r,j)=>r[0]=j+1);
  d.count=d.rows.length;
  (d.removed=d.removed||[]).push(String(tk).trim().toUpperCase());
  if(pf3Sel===tk)pf3Sel=null;
  scheduleSave();
  init();
  toast(tk+' удалён');
}

function renderPF3(){
  const el=document.getElementById('pf3Area'),d=pf3D();
  if(!el||!d)return;
  if(pf3Tab==='sec'||pf3Tab==='typ'){
    el.innerHTML=`<div class="pf3-wrap">${v3Key===PF3_KEY?pf3Summary():""}${pf3GroupedHTML(pf3Tab)}</div>`;
    return;
  }
  if(pf3Tab==='cal'){
    el.innerHTML=`<div class="pf3-wrap">${v3Key===PF3_KEY?pf3Summary():""}${pf3CalendarHTML()}</div>`;
    pf3LoadCalendar();   // no-op when cached; re-renders this tab when done
    return;
  }
  if(pf3Tab==='health'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3HealthTab()}</div>`;
    return;
  }
  if(pf3Tab==='ai'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3AiHTML()}</div>`;
    return;
  }
  if(pf3Tab==='prop'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3PropHTML()}</div>`;
    return;
  }
  if(pf3Sel&&!d.rows.some(r=>String(r[2]||'')===pf3Sel))pf3Sel=null;
  const open=!!pf3Sel;
  el.innerHTML=`<div class="pf3-wrap">${v3Key===PF3_KEY?pf3Summary():""}<div class="pf3-layout${open?' open':''}">
    ${open?`<div class="pf3-detail">${pf3DetailHTML()}</div>`:''}
    <aside class="pf3-list">
      <div class="pf3-list-hd"><span>📋 Акции · ${v3Key===PF3_KEY?'Портфель 3.0':v3Key}</span>${open?'':'<button class="pf3-btn pf3-btn-sm" id="pf3RefreshBtn" onclick="pf3Refresh()">🔄 Обновить акции</button>'}</div>
      ${pf3ListHead()}
      ${pf3ListHTML()}
      ${open||v3Key!==PF3_KEY?'':`<form class="pf3-add" onsubmit="pf3Add(event)">
        <input id="pf3AddTicker" placeholder="Тикер" autocomplete="off">
        <input id="pf3AddQty" type="number" step="any" min="0" placeholder="Кол-во">
        <input id="pf3AddBuy" type="number" step="any" min="0" placeholder="Цена покупки">
        <select id="pf3AddCcy"><option>USD</option><option>EUR</option><option selected>SEK</option><option>NOK</option><option>DKK</option></select>
        <button class="pf3-btn" type="submit">➕ Добавить акцию</button>
      </form>
      <div class="pf3-empty" style="padding:4px 4px">Нажмите на строку — карточка с полными данными откроется слева от списка</div>`}
    </aside>
  </div></div>`;
  if(open){
    const r=d.rows[pf3SelIdx()];
    pf3State.row=r;pf3State.ccy=r[8]||'USD';
    drawChart(pf3State,'pf3ChartBox','pf3Legend');
    pf3LoadFundamentals();   // no-op when cached; re-renders the health cards when done
    pf3LoadEarnings();       // same for the earnings calendar panel
  }
}

// The full card for the selected holding (everything: hero, stats, health, earnings, chart, buy levels).
function pf3DetailHTML(){
  const d=pf3D(),ri=pf3SelIdx();
  recalcPF(ri,v3Key);
  const r=d.rows[ri],h=d.headers,tk=String(r[2]||'');
  const qty=parseFloat(r[6])||0,price=parseFloat(r[7])||0,buy=parseFloat(r[9])||0,ccy=r[8]||'USD';
  const day=parseFloat(r[10]),valSEK=parseFloat(r[13])||0,profit=parseFloat(r[11])||0,ppct=parseFloat(r[12])||0;
  const {s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление'),tgC=h.findIndex(x=>/аналит/i.test(x));
  const target=tgC>=0?parseFloat(r[tgC]):NaN;
  const hasTarget=isFinite(target)&&target>0&&price>0;
  const chips=[tk+(ccy==='USD'?' · NASDAQ':''),r[3],r[4]].filter(c=>c&&c!=='—').map(c=>`<span class="pf3-chip">${c}</span>`).join('');
  // One technical level row: value + coloured distance from the current price.
  const lvl=(name,v)=>{const n=parseFloat(v);if(!(n>0)||!(price>0))return'';const dist=(price-n)/n*100,up=dist>=0;
    return`<div class="pf3-lvl"><span class="pf3-lvl-name">${name}</span><span class="pf3-lvl-val">${pf3Fmt(n,2)}</span><span class="pf3-lvl-dist ${up?'pf3-up-bg':'pf3-down-bg'}">${up?'▲':'▼'} ${Math.abs(dist).toFixed(1)}%</span></div>`};
  return`
    <section class="pf3-hero">
      <button class="pf3-close" onclick="pf3Select('${tk}')" title="Закрыть карточку">✕</button>
      <div class="pf3-id">
        <div class="pf3-logo">${tk.slice(0,2)}</div>
        <div>
          <h2>${r[1]||tk}</h2>
          <div class="pf3-chips">${chips}</div>
        </div>
      </div>
      <div class="pf3-quote">
        <div class="pf3-price">${price>0?pf3Fmt(price,2):'—'} <small>${ccy}</small></div>
        ${isFinite(day)?`<div class="pf3-day ${day>=0?'pf3-up-bg':'pf3-down-bg'}">${day>0?'+':''}${day.toFixed(2)}% за день</div>`:''}
        <button class="pf3-btn" id="pf3RefreshBtn" onclick="pf3Refresh()">🔄 Обновить цену</button>
      </div>
    </section>
    <section class="pf3-cards">
      ${v3Key===PF3_KEY?`<div class="pf3-card"><div class="pf3-card-l">Стоимость позиции</div><div class="pf3-card-v">${pf3Fmt(valSEK)} kr</div><div class="pf3-card-s">${pf3Fmt(qty)} акц. × ${pf3Fmt(price,2)} ${ccy}</div></div>
      <div class="pf3-card"><div class="pf3-card-l">Прибыль</div><div class="pf3-card-v ${profit>=0?'pf3-up':'pf3-down'}">${profit>0?'+':''}${pf3Fmt(profit)} kr</div><div class="pf3-card-s ${ppct>=0?'pf3-up':'pf3-down'}">${ppct>0?'+':''}${ppct.toFixed(1)}% от покупки</div></div>
      <div class="pf3-card"><div class="pf3-card-l">Цена покупки</div><div class="pf3-card-v">${pf3Fmt(buy,2)} <small>${ccy}</small></div><div class="pf3-card-s">вложено ${pf3Fmt(qty*buy*(FX[ccy]||1))} kr</div></div>`:''}
      <div class="pf3-card"><div class="pf3-card-l">Аналит. таргет</div><div class="pf3-card-v">${hasTarget?pf3Fmt(target,0)+' <small>'+ccy+'</small>':'—'}</div><div class="pf3-card-s ${hasTarget&&target>=price?'pf3-up':'pf3-down'}">${hasTarget?(target>=price?'+':'')+((target-price)/price*100).toFixed(1)+'% потенциал':'заполняется worker-ом (cron / ?action=targets)'}</div></div>
    </section>
    <section class="pf3-panel">
      <div class="pf3-panel-hd"><span>💪 Здоровье бизнеса <span class="pf3-asof" id="pf3FundAsof">${(pf3FundData()||{}).asOf?'отчёт от '+pf3FundData().asOf:''}</span></span><span class="pf3-tf"><button id="pf3FundAnnualBtn" class="pf3-tfbtn${pf3Fund.period==='annual'?' on':''}" onclick="pf3SetFundPeriod('annual')">Годовой отчёт</button><button id="pf3FundQuarterBtn" class="pf3-tfbtn${pf3Fund.period==='quarter'?' on':''}" onclick="pf3SetFundPeriod('quarter')">Посл. квартал</button></span></div>
      <div class="pf3-health-grid" id="pf3HealthGrid">${pf3Health()}</div>
    </section>
    <section class="pf3-panel">
      <div class="pf3-panel-hd"><span>📅 Ближайший отчёт и ожидания рынка</span></div>
      <div id="pf3EarnBody">${pf3Earnings()}</div>
    </section>
    <section class="pf3-grid">
      <div class="pf3-panel">
        <div class="pf3-panel-hd"><span>📈 График · SMA 50/100/200 · уровни</span><span class="pf3-tf"><button class="pf3-tfbtn${pf3State.years===1?' on':''}" onclick="pf3SetYears(1)">1Г</button><button class="pf3-tfbtn${pf3State.years===3?' on':''}" onclick="pf3SetYears(3)">3Г</button></span></div>
        <div id="pf3ChartBox" class="pf3-chart"></div>
        <div id="pf3Legend" class="chart-legend"></div>
      </div>
      <div class="pf3-panel">
        <div class="pf3-panel-hd"><span>🎯 Технические уровни</span></div>
        ${lvl('SMA 50',s50>=0?r[s50]:'')+lvl('SMA 100',s100>=0?r[s100]:'')+lvl('SMA 200',s200>=0?r[s200]:'')+lvl('Поддержка',supC>=0?r[supC]:'')+lvl('Сопротивление',resC>=0?r[resC]:'')||'<div class="pf3-empty">Нажмите «Обновить цену», чтобы загрузить уровни</div>'}
        ${v3Key===PF3_KEY?`<div class="pf3-panel-hd" style="margin-top:18px"><span>✏️ Моя позиция</span></div>
        <div class="pf3-edit">
          <label>Кол-во акций <input type="number" step="any" min="0" value="${qty}" onchange="pf3Edit(6,this.value)"></label>
          <label>Цена покупки (${ccy}) <input type="number" step="any" min="0" value="${buy}" onchange="pf3Edit(9,this.value)"></label>
        </div>`:''}
      </div>
    </section>
    <section class="pf3-panel">
      <div class="pf3-panel-hd"><span>🛒 Уровни покупки / докупки</span><span class="pf3-asof">по техданным · авто-обновление каждые 5 мин</span></div>
      ${pf3BuySection(r,h,price,ccy)}
    </section>`;
}
function pf3Edit(ci,v){const ri=pf3SelIdx(),n=parseFloat(v);pf3D().rows[ri][ci]=isNaN(n)?0:n;recalcPF(ri,v3Key);scheduleSave();renderPF3()}
function pf3SetYears(y){pf3State.years=y;renderPF3()}
async function pf3Refresh(silent){
  const d=pf3D();
  const btn=document.getElementById('pf3RefreshBtn');
  if(btn&&!silent){btn.disabled=true;btn.textContent='⏳ Обновляю…';}
  try{
    // Batched in chunks of 20 — the worker makes 2 Yahoo calls per symbol and
    // Cloudflare caps subrequests, so a 100-ticker index needs several requests.
    const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
    const prices={};
    for(let i=0;i<syms.length;i+=20){
      const part=await(await fetch(PRICE_PROXY+'?symbols='+encodeURIComponent(syms.slice(i,i+20).join(',')))).json();
      Object.assign(prices,part||{});
    }
    const {s50,s100,s200}=smaIdx(d);
    const supI=ensurePFCol(d,'Поддержка'),resI=ensurePFCol(d,'Сопротивление');
    let updated=0;
    d.rows.forEach((r,i)=>{
      const q=prices[exSymbol(r[2],r[8])];
      if(!(q&&typeof q.price==='number'))return;
      r[7]=q.price;
      if(typeof q.pct==='number')r[10]=Math.round(q.pct*100)/100;
      if(s50>=0&&q.sma50!=null)r[s50]=q.sma50;
      if(s100>=0&&q.sma100!=null)r[s100]=q.sma100;
      if(s200>=0&&q.sma200!=null)r[s200]=q.sma200;
      if(q.support!=null)r[supI]=q.support;
      if(q.resistance!=null)r[resI]=q.resistance;
      recalcPF(i,v3Key);updated++;
    });
    if(updated){scheduleSave();pf3LastRefresh=Date.now();}
    if(!silent)toast(`🔄 ${updated}/${d.rows.length} обновлено`,!updated);
  }catch(e){if(!silent)toast('Прокси цен недоступен',true);}
  // Don't redraw under the user's cursor while they edit qty / buy price.
  const ae=document.activeElement,area=document.getElementById('pf3Area');
  if(!(silent&&ae&&ae.tagName==='INPUT'&&area&&area.contains(ae)))renderPF3();
}

// Auto-refresh while the Портфель 3.0 tab is open: immediately when stale, then every 5 min.
let pf3Timer=null,pf3LastRefresh=0;
const PF3_REFRESH_MS=5*60*1000;
function pf3EnsureAutoRefresh(){
  if(!pf3Timer)pf3Timer=setInterval(()=>{if(isV3())pf3Refresh(true)},PF3_REFRESH_MS);
  if(Date.now()-pf3LastRefresh>PF3_REFRESH_MS)pf3Refresh(true);
}
function pf3StopAutoRefresh(){if(pf3Timer){clearInterval(pf3Timer);pf3Timer=null}}

async function refreshLivePrices(){
  if(!isAnalysis()){ toast('Обновление цен доступно на вкладках 💼 Портфель и Nasdaq 100'); return; }
  const d = DATA[curIdx];
  const priceC = d.headers.findIndex(x=>/^цена/i.test(x));   // price column (position varies by tab schema)
  const dayC = d.headers.findIndex(x=>/1д|день/i.test(x));   // 1-day % column
  const supIdx = ensurePFCol(d, 'Поддержка');        // Support level (rolling 3-month low)
  const resIdx = ensurePFCol(d, 'Сопротивление');    // Resistance level (rolling 3-month high)
  const tfExisted = d.headers.includes(SMA_TF_COL);
  ensurePFCol(d, SMA_TF_COL);                        // per-stock 1Г/3Г SMA timeframe toggle
  if(!tfExisted) positionAfter(d, d.headers.indexOf(SMA_TF_COL), /sma.?200/i);   // place right after SMA 200
  const btn = document.getElementById('refreshPricesBtn');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ …'; }
  let updated = 0, manual = 0;
  manualPriceRows.clear();

  if(PRICE_PROXY){
    // One batched request → covers US + Nordic/EU via Yahoo.
    const symbols = [...new Set(d.rows.map(r => exSymbol(r[2], rowCcy(r))).filter(Boolean))];
    let prices = {};
    try{
      const r = await fetch(PRICE_PROXY + '?symbols=' + encodeURIComponent(symbols.join(',')));
      if(!r.ok) throw new Error('proxy ' + r.status);
      prices = await r.json();
    }catch(e){
      if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; }
      toast('Прокси цен недоступен — проверьте PRICE_PROXY', true); return;
    }
    d.rows.forEach((row, i) => {
      const p = prices[exSymbol(row[2], rowCcy(row))];
      const price = (p && typeof p === 'object') ? p.price : p;   // worker now returns {price,pct}; tolerate legacy number
      if(price != null){
        if(priceC>=0) row[priceC] = price;
        if(p && typeof p === 'object'){
          if(dayC>=0 && typeof p.pct === 'number') row[dayC] = Math.round(p.pct * 100) / 100;   // 1д %
          if(typeof p.support === 'number') row[supIdx] = p.support;                    // Поддержка
          if(typeof p.resistance === 'number') row[resIdx] = p.resistance;              // Сопротивление
          // Store both daily (1Y) and weekly (3Y) SMA sets; show the one matching this stock's toggle.
          const tk = String(row[2] || ''), mode = (SMA_TF[tk] && SMA_TF[tk].mode) || '1Y';
          SMA_TF[tk] = { mode,
            d: [p.sma50 ?? null, p.sma100 ?? null, p.sma200 ?? null],
            w: [p.sma50w ?? null, p.sma100w ?? null, p.sma200w ?? null] };
          applySmaTF(d, i);
        }
        updated++;
      } else { manual++; manualPriceRows.add(i); }
    });
  } else {
    // Fallback: Finnhub free tier (US only).
    if(!finnhubKey){
      const k = prompt('Вставьте Finnhub API ключ (бесплатно), или задайте PRICE_PROXY для полного покрытия:');
      if(!k){ if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; } return; }
      finnhubKey = k.trim(); scheduleSave();
    }
    for(let i = 0; i < d.rows.length; i++){
      const row = d.rows[i];
      let q = null;
      try{ q = await fetchFinnhub(exSymbol(row[2], rowCcy(row))); }catch(e){ q = null; }
      if(q != null){ if(priceC>=0) row[priceC] = q.price; if(dayC>=0 && typeof q.pct === 'number') row[dayC] = Math.round(q.pct * 100) / 100; updated++; } else { manual++; manualPriceRows.add(i); }
    }
  }

  renderTable(); scheduleSave();
  if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; }
  toast(`🔄 ${updated} обновлено · ${manual} вручную` + (manual ? ' (выделены жёлтым)' : ''));
}

/* ===== Column visibility (per-tab, synced) ===== */
function toggleColsMenu(){
  const ex = document.getElementById('colsMenu');
  if(ex){ ex.remove(); document.removeEventListener('click', closeColsOnOutside); return; }
  const m = document.createElement('div'); m.id = 'colsMenu'; m.className = 'cols-menu';
  const hdrs = DATA[curIdx].headers, hid = hiddenCols[curIdx] || [];
  let html = '<div class="cols-menu-hd"><span>Колонки</span><button onclick="showAllCols()">Все</button></div>';
  hdrs.forEach((h, ci) => {
    html += `<label><input type="checkbox" ${hid.includes(ci) ? '' : 'checked'} onchange="toggleCol(${ci})"> ${h || '—'}</label>`;
  });
  m.innerHTML = html;
  document.body.appendChild(m);
  const btn = document.getElementById('colsBtn'), r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  setTimeout(() => document.addEventListener('click', closeColsOnOutside), 0);
}
function closeColsOnOutside(e){
  const m = document.getElementById('colsMenu');
  if(m && !m.contains(e.target) && e.target.id !== 'colsBtn'){
    m.remove(); document.removeEventListener('click', closeColsOnOutside);
  }
}
function toggleCol(ci){
  if(!hiddenCols[curIdx]) hiddenCols[curIdx] = [];
  const arr = hiddenCols[curIdx], i = arr.indexOf(ci);
  if(i >= 0) arr.splice(i, 1); else arr.push(ci);
  scheduleSave(); renderTable();
}
function showAllCols(){
  hiddenCols[curIdx] = []; scheduleSave(); renderTable();
  const m = document.getElementById('colsMenu'); if(m) m.remove();
}

boot();
