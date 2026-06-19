# MarketGyan Training Run Error Audit

This audit joins the supplied baseline and Qwen prediction artifacts back to `nepse-impact-500.jsonl` by record ID. The run predates the balanced compact-Qwen rerun, so use this for label review and model-error diagnosis, not as the final benchmark.

## Summary

- `xlmr-relevance`: 22/75 errors; confusion `{'not_relevant -> not_relevant': 27, 'direct -> direct': 19, 'indirect -> not_relevant': 5, 'not_relevant -> indirect': 4, 'indirect -> indirect': 7, 'not_relevant -> direct': 3, 'indirect -> direct': 2, 'direct -> not_relevant': 3, 'direct -> indirect': 5}`
- `xlmr-direction`: 15/41 errors; confusion `{'bearish -> bearish': 7, 'uncertain -> uncertain': 18, 'bullish -> bearish': 2, 'bearish -> uncertain': 3, 'bullish -> uncertain': 9, 'bullish -> bullish': 1, 'neutral -> bearish': 1}`
- `finbert-english-direction`: 1/14 errors; confusion `{'bearish -> bearish': 8, 'bullish -> bullish': 5, 'neutral -> bullish': 1}`
- `qwen-qlora`: 44/75 invalid/truncated JSON outputs.
- `qwen-qlora`: 15 relevance mismatches among valid JSON outputs.
- `qwen-qlora`: 10 valid hard-negative false positives.
- `qwen-qlora`: 5 relevant-record direction mismatches.

Generated files:

- `priority-samples-for-revalidation.csv`: sort this first during manual review.
- `all-model-errors.csv`: every joined model error row.
- `training-run-error-audit.json`: full machine-readable audit.

## Highest Priority Samples To Revalidate

### `6a2f0a578a1c034887d3081f`
- Title: कृषि मन्त्रालयले भन्यो- मलको अभाव छैन, झन्डै डेढ लाख मेट्रिक टन मौज्दात छ
- Source: बिजनेस – Page 12 – Online Khabar | 2026-05-19T15:48:54.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `10`
- Reason to inspect: xlmr-relevance: not_relevant->indirect; qwen relevance: not_relevant->direct
- Evidence IDs: S2;S5
- Rationale: यो समाचार कृषि क्षेत्रको मलको आपूर्ति र मूल्यसँग सम्बन्धित सामान्य खबर हो, जसले नेप्से बजार वा सूचीकृत कम्पनीहरूमा पर्ने कुनै प्रत्यक्ष वा प्रमाणित संयन्त्र देखाउँदैन।

### `6a2f0a578a1c034887d3082b`
- Title: धनियाँको मूल्य बढ्यो, पुदिनाको घट्यो
- Source: बिजनेस – Page 11 – Online Khabar | 2026-05-25T07:13:34.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `10`
- Reason to inspect: xlmr-relevance: not_relevant->direct; qwen relevance: not_relevant->direct
- Evidence IDs: S2;S3;S4;S5
- Rationale: यो समाचार कृषि वस्तु (धनियाँ र पुदिना) को मूल्यमा केन्द्रित छ, जसको नेप्से (NEPSE) वा शेयर बजारमा कुनै प्रत्यक्ष वा अप्रत्यक्ष प्रभाव पर्दैन।

### `6a2f0a578a1c034887d30837`
- Title: धेरै नाफा गर्ने संस्थान आयल निगम, नेवानिको घाटा सवा अर्ब
- Source: बिजनेस – Page 9 – Online Khabar | 2026-05-27T15:45:08.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `10`
- Reason to inspect: xlmr-relevance: not_relevant->indirect; qwen relevance: not_relevant->direct
- Evidence IDs: S2;S3;S4;S5;S8
- Rationale: यो समाचार सार्वजनिक संस्थानहरूको वित्तीय अवस्था र सरकारको लगानीको बारेमा मात्र छ । यी संस्थानहरू नेप्सेमा सूचीकृत नभएको र यसले शेयर बजारमा पर्ने कुनै विशेष संयन्त्र उल्लेख नभएकोले यो सान्दर्भिक छैन ।

### `6a2f0a578a1c034887d30843`
- Title: एक महिनामै ३२ प्रतिशत महँगियो आलु
- Source: बिजनेस – Page 7 – Online Khabar | 2026-06-01T07:09:21.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `10`
- Reason to inspect: xlmr-relevance: not_relevant->direct; qwen relevance: not_relevant->direct
- Evidence IDs: S2;S6;S9
- Rationale: यो समाचारले तरकारीको बजार मूल्यमा भएको परिवर्तनबारे जानकारी दिएको छ, जसको शेयर बजार (NEPSE) सँग कुनै प्रत्यक्ष वा अप्रत्यक्ष सम्बन्ध देखिएको छैन।

### `6a2f0a578a1c034887d3084f`
- Title: निगुरोको मूल्य बढ्यो
- Source: बिजनेस – Page 5 – Online Khabar | 2026-06-04T06:28:23.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `10`
- Reason to inspect: xlmr-relevance: not_relevant->direct; qwen relevance: not_relevant->direct
- Evidence IDs: S2
- Rationale: यो समाचार स्थानीय कृषि उत्पादनको मूल्यसँग सम्बन्धित छ, जसको NEPSE वा सूचीकृत कम्पनीहरूसँग कुनै प्रत्यक्ष वा अप्रत्यक्ष सम्बन्ध छैन ।

### `6a2f0a578a1c034887d3083f`
- Title: सेयर बजारलाई उत्कृष्ट बजेट, यस्ता छन् समेटिएका विषय
- Source: बिजनेस – Page 7 – Online Khabar | 2026-05-29T14:42:30.000Z
- Gold: `direct` / `fiscal_macroeconomic` / `bullish`
- Priority score: `8`
- Reason to inspect: xlmr-relevance: direct->not_relevant; xlmr-direction: bullish->uncertain; qwen invalid/truncated JSON
- Evidence IDs: S3;S4;S6;S9;S2
- Rationale: पूँजीगत लाभकर अन्तिम हुने नीतिगत व्यवस्थाले बजारमा अनिश्चितता र विवाद कम गर्ने देखिएकाले सरोकारवालाहरूले यसलाई सकारात्मक मान्नुका साथै करको दरमा भएको वृद्धिले लगानीकर्ताको खुद प्रतिफलमा असर पार्ने देखिन्छ।

### `6a2f0a578a1c034887d30846`
- Title: हिमालयन बैंक र यूनियन पेको सहकार्यमा ‘आरएमबी कार्ड’ सेवा सुरु
- Source: बिजनेस – Page 6 – Online Khabar | 2026-06-01T13:15:21.000Z
- Gold: `direct` / `project_operations` / `bullish`
- Priority score: `8`
- Reason to inspect: xlmr-relevance: direct->not_relevant; xlmr-direction: bullish->uncertain; qwen invalid/truncated JSON
- Evidence IDs: S2;S6;S8
- Rationale: नयाँ आरएमबी कार्ड सेवाको माध्यमबाट बैंकले चिनियाँ भ्रमण गर्ने ग्राहकहरूबाट हुने कारोबार र सेवा शुल्क मार्फत राजस्व बढाउन सक्ने सम्भावना रहन्छ ।

### `6a2f0a578a1c034887d3085a`
- Title: नबिल बैंकद्वारा नेपाल–भारत क्रस बोर्डर पीटूपी रेमिट्यान्स सेवा सञ्चालन
- Source: बिजनेस – Page 4 – Online Khabar | 2026-06-07T08:14:17.000Z
- Gold: `direct` / `project_operations` / `bullish`
- Priority score: `7`
- Reason to inspect: xlmr-relevance: direct->not_relevant; xlmr-direction: bullish->uncertain
- Evidence IDs: S2;S3;S4;S5;S6;S10
- Rationale: नयाँ रेमिट्यान्स सेवाको सुरुवातले बैंकको सेवा विस्तार गर्नुका साथै कारोबारको मात्रा र राजस्व बढाउन मद्दत पुर्‍याउन सक्छ।

### `6a2f0a578a1c034887d30834`
- Title: देशभरि ६२ लाख ४९ हजार सवारीसाधन दर्ता, मोटरसाइकल मात्र ५० लाख
- Source: बिजनेस – Page 9 – Online Khabar | 2026-05-27T09:16:06.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `6`
- Reason to inspect: xlmr-relevance: not_relevant->indirect; qwen invalid/truncated JSON
- Evidence IDs: S2;S3
- Rationale: सवारीसाधन दर्ता र लाइसेन्स वितरण सम्बन्धी यो तथ्याङ्कीय समाचारको NEPSE मा कुनै प्रत्यक्ष वा अप्रत्यक्ष प्रभाव देखिँदैन।

### `6a2f0a578a1c034887d3083a`
- Title: कर्जा दिनै डराउन थाले बैंकर
- Source: बिजनेस – Page 8 – Online Khabar | 2026-05-28T16:01:15.000Z
- Gold: `indirect` / `monetary_liquidity` / `bearish`
- Priority score: `6`
- Reason to inspect: xlmr-relevance: indirect->not_relevant; xlmr-direction: bearish->uncertain; qwen invalid/truncated JSON
- Evidence IDs: S2;S3;S4;S6;S13;S14
- Rationale: बैंकरहरूले कर्जा प्रवाहमा कडाइ गर्दा र राष्ट्र बैंकले सेयर बजारसँग सम्बन्धित क्षेत्रमा कर्जा नीति कडाइ गर्दा बजारमा तरलता संकुचन भई सेयर बजारमा नकारात्मक असर पर्न सक्छ।

### `6a2f0a578a1c034887d30842`
- Title: IPO for General Public: Sanigad Hydro Limited Issue 46,74,000 Units IPO Shares from Today
- Source: ShareSansar | 2026-06-01T02:40:00.000Z
- Gold: `direct` / `capital_action` / `bullish`
- Priority score: `6`
- Reason to inspect: xlmr-relevance: direct->indirect; xlmr-direction: bullish->uncertain; qwen direction: bullish->uncertain
- Evidence IDs: S1;S12;S15
- Rationale: Sanigad Hydro Limited is raising capital through its IPO and has also received a rating upgrade from ICRA Nepal.

### `6a2f0a578a1c034887d3084e`
- Title: IPO Issue of Sanigad Hydro Limited Closing Today; Oversubscribed 5.88 Times So Far
- Source: ShareSansar | 2026-06-04T00:52:00.000Z
- Gold: `direct` / `capital_action` / `bullish`
- Priority score: `6`
- Reason to inspect: xlmr-relevance: direct->indirect; xlmr-direction: bullish->uncertain; qwen direction: bullish->uncertain
- Evidence IDs: S1;S15;S16
- Rationale: The IPO of Sanigad Hydro Limited has been oversubscribed 5.88 times and the company's issuer rating has been upgraded by ICRA Nepal, indicating strong investor demand and improved creditworthiness.

### `6a2f0a578a1c034887d30850`
- Title: ग्लोबल आईएमई बैंकको अगुवाइमा सुपर तमोर जलविद्युत् आयोजनामा १९ अर्ब ऋण सम्झौता
- Source: बिजनेस – Page 5 – Online Khabar | 2026-06-04T06:43:43.000Z
- Gold: `direct` / `credit_financing` / `bullish`
- Priority score: `6`
- Reason to inspect: xlmr-relevance: direct->indirect; xlmr-direction: bullish->uncertain; qwen invalid/truncated JSON
- Evidence IDs: S2;S4;S6
- Rationale: बैंकहरूले ठूलो रकम कर्जा प्रवाह गर्दा ब्याज आम्दानी बढ्ने सम्भावना रहन्छ ।

### `6a2f0a578a1c034887d30851`
- Title: १६६ मेगावाटको सुपर तमोर आयोजनालाई जुट्यो १९ अर्ब ऋण
- Source: बिजनेस – Page 5 – Online Khabar | 2026-06-04T06:49:36.000Z
- Gold: `direct` / `credit_financing` / `bullish`
- Priority score: `6`
- Reason to inspect: xlmr-relevance: direct->indirect; xlmr-direction: bullish->uncertain; qwen invalid/truncated JSON
- Evidence IDs: S2;S3;S4;S8
- Rationale: विभिन्न बैंकहरूले जलविद्युत आयोजनामा ऋण प्रवाह गर्दा उनीहरूको कर्जा विस्तार र ब्याज आम्दानीमा वृद्धि हुन सक्छ ।

### `6a2f0a578a1c034887d30869`
- Title: कुमारी बैंकको ‘ईआरपी’ एकीकृत डिजिटल कर्जा प्ल्याटफर्म सञ्चालनमा
- Source: बिजनेस – Page 2 – Online Khabar | 2026-06-12T08:02:56.000Z
- Gold: `direct` / `project_operations` / `bullish`
- Priority score: `6`
- Reason to inspect: xlmr-relevance: direct->indirect; xlmr-direction: bullish->uncertain; qwen invalid/truncated JSON
- Evidence IDs: S2;S3;S8
- Rationale: नयाँ डिजिटल कर्जा प्ल्याटफर्मको सञ्चालनले बैंकको कर्जा विस्तारमा मद्दत पुग्ने र डिजिटल बैंकिङ सेवा मार्फत राजस्व वृद्धि हुने सम्भावना रहन्छ ।

### `6a2f0a578a1c034887d3086e`
- Title: Traditional marketplaces in Nepal’s Tarai are shifting. So are crop yields
- Source: The Kathmandu Post - Money | 2026-06-13T00:00:00.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `6`
- Reason to inspect: xlmr-relevance: not_relevant->indirect; qwen invalid/truncated JSON
- Evidence IDs: S1
- Rationale: The content focuses on rural agricultural trade dynamics and local market structures in the Tarai region, which does not have a direct or documented mechanism affecting the NEPSE or listed securities.

### `6a2f0a578a1c034887d30821`
- Title: सीजी मोटर्सको महामेला एक्स्चेन्ज कार्निभल भृकुटीमण्डपमा सुरु
- Source: बिजनेस – Page 12 – Online Khabar | 2026-05-20T11:34:01.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `5`
- Reason to inspect: qwen relevance: not_relevant->direct
- Evidence IDs: S2;S5
- Rationale: यो समाचार सीजी मोटर्सको एउटा प्रवर्द्धनात्मक कार्यक्रम र नयाँ उत्पादन सार्वजनिक गर्ने बारेमा मात्र केन्द्रित छ, जसको नेप्से बजारमा कुनै ठोस प्रभाव पर्ने देखिँदैन।

### `6a2f0a578a1c034887d3082c`
- Title: वनप्लसले नयाँ ओलेड ट्याब्लेट चाँडै सार्वजनिक गर्ने
- Source: बिजनेस – Page 10 – Online Khabar | 2026-05-25T10:53:00.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `5`
- Reason to inspect: qwen relevance: not_relevant->direct
- Evidence IDs: S1
- Rationale: यो समाचार वनप्लस नामक विदेशी प्रविधि कम्पनीको नयाँ उत्पादनको बारेमा हो, जसको नेपालको सेयर बजारमा कुनै प्रत्यक्ष वा अप्रत्यक्ष प्रभाव देखिँदैन।

### `6a2f0a578a1c034887d30831`
- Title: अन्डाको मूल्यवृद्धि रोकिएन, फेरि बढाइयो क्रेटमा १५ रुपैयाँ
- Source: बिजनेस – Page 10 – Online Khabar | 2026-05-26T08:42:51.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `5`
- Reason to inspect: qwen relevance: not_relevant->direct
- Evidence IDs: S2;S4;S11
- Rationale: यो समाचार अन्डाको मूल्य वृद्धि सँग सम्बन्धित छ, जसको नेप्से (NEPSE) बजार वा कुनै सूचीबद्ध कम्पनीमा प्रत्यक्ष वा अप्रत्यक्ष प्रभाव पर्ने कुनै ठोस संयन्त्र देखिँदैन ।

### `6a2f0a578a1c034887d30839`
- Title: यातायात व्यवसायी र ट्राफिक प्रहरीको आह्वान : मापसे/लापसे गरी सवारी नचलाऔं
- Source: बिजनेस – Page 9 – Online Khabar | 2026-05-28T08:41:30.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `5`
- Reason to inspect: qwen relevance: not_relevant->direct
- Evidence IDs: S2;S3
- Rationale: यो समाचार यातायात क्षेत्रको परिचालन र सुरक्षासँग सम्बन्धित सामान्य सूचना भएकोले यसले नेप्से (NEPSE) बजार वा कुनै पनि सूचीबद्ध कम्पनीको मूल्यमा प्रत्यक्ष वा अप्रत्यक्ष प्रभाव पार्ने कुनै प्रमाण देखिँदैन।

### `6a2f0a578a1c034887d3085e`
- Title: बुद्ध एयरले ‘रोयल क्लब’ सदस्यलाई १२ सयसम्म छुट दिने
- Source: बिजनेस – Page 4 – Online Khabar | 2026-06-08T09:15:34.000Z
- Gold: `not_relevant` / `not_applicable` / `not_applicable`
- Priority score: `5`
- Reason to inspect: qwen relevance: not_relevant->direct
- Evidence IDs: S2
- Rationale: यो समाचार बुद्ध एयरको प्रवर्द्धनात्मक (promotional) गतिविधिसँग सम्बन्धित छ, जसको नेप्से (NEPSE) वा कुनै पनि सूचीकृत कम्पनीको वित्तीय अवस्थामा कुनै प्रत्यक्ष वा अप्रत्यक्ष प्रभाव देखिँदैन ।

### `6a2f0a578a1c034887d3083c`
- Title: विदेशी विनिमय सञ्चितिलाई ‘सोभरिन वेल्थ फन्ड’ परिचालन
- Source: बिजनेस – Page 8 – Online Khabar | 2026-05-29T10:58:50.000Z
- Gold: `indirect` / `fiscal_macroeconomic` / `uncertain`
- Priority score: `4`
- Reason to inspect: xlmr-relevance: indirect->direct; qwen relevance: indirect->direct
- Evidence IDs: S2;S3;S4
- Rationale: सरकारले विदेशी विनिमय सञ्चितिबाट सोभरिन वेल्थ फन्ड परिचालन गर्ने नीति लिएमा यसले देशको वित्तीय तरलता र लगानीको वातावरणमा प्रभाव पार्न सक्छ ।

### `6a2f0a578a1c034887d30844`
- Title: बजेटप्रति सेयर लगानीकर्ता निराश, तीन समूहगत सूचकमा उच्च प्रभाव
- Source: बिजनेस – Page 6 – Online Khabar | 2026-06-01T09:35:31.000Z
- Gold: `direct` / `fiscal_macroeconomic` / `bearish`
- Priority score: `4`
- Reason to inspect: xlmr-direction: bearish->uncertain; qwen invalid/truncated JSON
- Evidence IDs: S2;S4;S5;S7;S15
- Rationale: बजेटमा पूँजीगत लाभकर अल्पकालीनका लागि १० प्रतिशत र दीर्घकालीनका लागि साढे ७ प्रतिशत कायम गरिएको र केही आम्दानीमा थप करको आशय भएकाले लगानीकर्ताहरू असन्तुष्ट भएका छन्, जसले बजारमा गिरावट निम्त्याएको छ ।

### `6a2f0a578a1c034887d30845`
- Title: पीपीपी मोडेलमा वेस्ट सेती ४०० केभी प्रसारण आयोजना अघि बढ्ने
- Source: बिजनेस – Page 6 – Online Khabar | 2026-06-01T13:05:22.000Z
- Gold: `indirect` / `sector_industry` / `bullish`
- Priority score: `4`
- Reason to inspect: xlmr-direction: bullish->uncertain; qwen invalid/truncated JSON
- Evidence IDs: S2;S3;S4
- Rationale: वेस्ट सेती ४०० केभी प्रसारण लाइन जस्ता ठूला पूर्वाधार आयोजनाले जलविद्युत् उत्पादन र प्रसारण प्रणालीबीचको अवरोध कम गरी ऊर्जा क्षेत्रको उत्पादन क्षमता र बिक्री क्षमतामा सकारात्मक प्रभाव पार्न सक्छ ।

### `6a31634a8dd189ed627e3606`
- Title: Fire Incident Disrupts 5 MW Power Production at Jhapa Energy Limited
- Source: ShareSansar | 2026-06-02T04:23:00.000Z
- Gold: `direct` / `sector_industry` / `bearish`
- Priority score: `4`
- Reason to inspect: xlmr-direction: bearish->uncertain; qwen direction: bearish->uncertain
- Evidence IDs: S1;S2;S3
- Rationale: The selected evidence reports a sector or company operating condition relevant to listed firms. This makes the record direct to NEPSE and supports the sector_industry label through the operations or capacity mechanism.
