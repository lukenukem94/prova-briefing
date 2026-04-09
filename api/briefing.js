const SYSTEM = `You are an intelligence analyst for Prova Risk, a UK compliance SaaS platform for the Terrorism (Protection of Premises) Act 2025 (Martyn's Law).
Respond ONLY with valid JSON — no markdown, no backticks, no preamble.
Governance rules (non-negotiable):
- Standard Tier premises use "public protection procedures" NEVER "measures" (measures = Enhanced Tier 800+ only)
- Use "premises" not "venue"; "organisation" not "business"
- Never claim Prova guarantees legal compliance (Home Office Myth 10)
- Tone: authoritative and factual, never alarmist`;

async function callClaude(userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${resp.status}`);
  }

  const data = await resp.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseJson(raw) {
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in response');
  return JSON.parse(clean.slice(start, end + 1));
}

async function postToSlack(data) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const news = data.newsArticles || [];
  const reddit = data.redditPosts || [];
  const li = data.linkedinRecommendations || [];
  const all = [...news, ...reddit];
  const total = all.length;
  const pos = all.filter(a => (a.overallSentiment || a.articleSentiment) === 'positive').length;
  const neg = all.filter(a => (a.overallSentiment || a.articleSentiment) === 'negative').length;
  const timestamp = new Date().toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
  });
  const emoji = s => s === 'positive' ? '🟢' : s === 'negative' ? '🔴' : '🟡';

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `Prova Risk — Martyn's Law Intelligence Briefing` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Generated ${timestamp} · Terrorism (Protection of Premises) Act 2025` }] },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*Overview*\n${data.overallOverview || ''}` } },
    { type: 'divider' },
    {
      type: 'section', fields: [
        { type: 'mrkdwn', text: `*Total mentions*\n${total}` },
        { type: 'mrkdwn', text: `*Supportive* 🟢\n${pos}` },
        { type: 'mrkdwn', text: `*Critical* 🔴\n${neg}` },
        { type: 'mrkdwn', text: `*LinkedIn prompts*\n${li.length}` }
      ]
    },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*News & trade press — ${news.length} articles*` } },
    ...news.slice(0, 5).map(a => ({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji(a.articleSentiment)} *${a.title}*\n_${a.source}_${a.sector ? ' · ' + a.sector : ''}\n${a.summary}` }
    })),
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*Reddit UGC — ${reddit.length} posts*\n${data.redditOverview || ''}` } },
    ...reddit.slice(0, 3).map(a => ({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji(a.overallSentiment)} *${a.title}*\n_${a.source}_\n${a.summary}` }
    })),
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*Top LinkedIn engagement prompts for Chris — ${li.length} recommendations*` } },
    ...li.slice(0, 7).map((item, i) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${i + 1}. ${item.articleTitle}* · _${item.source}_\n>${item.angle}\n✅ ${item.governanceNote}` }
    })),
    { type: 'divider' },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Sent by Prova Risk Intelligence Briefing · The Conscious Marketing Group` }] }
  ];

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks, text: `Martyn's Law Intelligence Briefing — ${timestamp}` })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Step 1: News search
    const newsRaw = await callClaude(
      `Search the web right now for mentions of "Martyn's Law" or "Terrorism Protection of Premises Act 2025" published in the last 14 days from: BBC News, The Guardian, Sky News, The Telegraph, GOV.UK, Home Office, and UK sector trade press covering education (schools, academies), places of worship, hospitality (hotels, venues), and retail.

Return ONLY this JSON structure:
{
  "newsArticles": [
    {
      "title": "article title",
      "source": "publication name",
      "url": "url",
      "sector": "Education|Hospitality|Places of Worship|Retail|Government|General",
      "articleSentiment": "positive|neutral|negative|mixed",
      "overallSentiment": "positive|neutral|negative|mixed",
      "summary": "2 sentence plain-English summary of what this article says about Martyn's Law"
    }
  ],
  "overallOverview": "2 sentence top-level summary of the current media landscape for Martyn's Law"
}`
    );

    let newsData;
    try { newsData = parseJson(newsRaw); }
    catch { newsData = { newsArticles: [], overallOverview: 'Could not parse news results.' }; }

    await delay(15000);

    // Step 2: Reddit scan
    const redditRaw = await callClaude(
      `Search the web for Reddit posts or threads mentioning "Martyn's Law" or "Terrorism Protection of Premises Act" in the last 30 days. Look in r/unitedkingdom, r/ukpolitics, r/education, r/hospitality, r/religion, r/smallbusiness, r/AskUK and similar.

Return ONLY this JSON structure:
{
  "redditPosts": [
    {
      "title": "post title",
      "source": "subreddit e.g. r/unitedkingdom",
      "url": "url if found",
      "articleSentiment": "positive|neutral|negative|mixed",
      "overallSentiment": "positive|neutral|negative|mixed",
      "summary": "2 sentence summary of post and notable comments",
      "traction": "low|medium|high"
    }
  ],
  "redditOverview": "1 sentence summary of Reddit sentiment toward Martyn's Law"
}`
    );

    let redditData;
    try { redditData = parseJson(redditRaw); }
    catch { redditData = { redditPosts: [], redditOverview: 'No Reddit data found.' }; }

    await delay(15000);

    // Step 3: LinkedIn recommendations
    const allArticles = [...(newsData.newsArticles || []), ...(redditData.redditPosts || [])];
    const liRaw = await callClaude(
      `These are recent articles and posts about Martyn's Law: ${JSON.stringify(allArticles.slice(0, 12))}

Select the top 7 most strategically valuable for Chris Hotchkiss (CEO, Prova Risk) to engage with on LinkedIn. Prioritise: factual corrections Chris can make, high-traction posts, sector-specific stories, and government developments.

For each LinkedIn angle:
- Must say "public protection procedures" for Standard Tier (never "measures")
- Must reference the Terrorism (Protection of Premises) Act 2025 in full alongside "Martyn's Law" at least once
- Must not claim Prova is required for legal compliance
- Should be authoritative, not alarmist
- Should be 2-3 sentences suitable as a LinkedIn comment or post hook
- Should position Chris as an expert, not a salesperson

Return ONLY this JSON structure:
{
  "linkedinRecommendations": [
    {
      "articleTitle": "title of the article or post",
      "source": "source name",
      "angle": "2-3 sentence LinkedIn response angle for Chris",
      "governanceNote": "one-line confirmation the copy is compliant with Prova governance rules"
    }
  ]
}`
    );

    let liData;
    try { liData = parseJson(liRaw); }
    catch { liData = { linkedinRecommendations: [] }; }

    const briefingData = { ...newsData, ...redditData, ...liData };

    await postToSlack(briefingData);

    return res.status(200).json(briefingData);

  } catch (e) {
    console.error('Briefing pipeline error:', e);
    return res.status(500).json({ error: e.message });
  }
}
