const escapeXml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const sanitizeFileName = (value = 'growth-plan') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 70) || 'growth-plan';

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date = new Date()) => {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
};

const writeUInt16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const writeUInt32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};

const createZip = (entries) => {
  const now = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  entries.forEach((entry) => {
    const name = Buffer.from(entry.name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(now.dosTime),
      writeUInt16(now.dosDate),
      writeUInt32(crc),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name
    ]);

    localParts.push(localHeader, data);

    centralParts.push(Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(now.dosTime),
      writeUInt16(now.dosDate),
      writeUInt32(crc),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      name
    ]));

    offset += localHeader.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const end = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(localData.length),
    writeUInt16(0)
  ]);

  return Buffer.concat([localData, centralDirectory, end]);
};

const SLIDE = {
  width: 9144000,
  height: 5143500
};

const COLORS = {
  navy: '0F172A',
  ink: '111827',
  slate: '334155',
  body: '475569',
  muted: '64748B',
  blue: '2563EB',
  blueDark: '1D4ED8',
  blueLight: 'DBEAFE',
  cyan: '38BDF8',
  green: '10B981',
  greenLight: 'D1FAE5',
  amber: 'F59E0B',
  amberLight: 'FEF3C7',
  bg: 'F8FAFC',
  card: 'FFFFFF',
  border: 'E2E8F0',
  white: 'FFFFFF'
};

const solidFillXml = (color) => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;

const lineXml = (color, width = 12700) => color
  ? `<a:ln w="${width}">${solidFillXml(color)}</a:ln>`
  : '<a:ln><a:noFill/></a:ln>';

const shadowXml = () => `
<a:effectLst>
  <a:outerShdw blurRad="63500" dist="25400" dir="5400000" algn="ctr" rotWithShape="0">
    <a:srgbClr val="CBD5E1"><a:alpha val="45000"/></a:srgbClr>
  </a:outerShdw>
</a:effectLst>`;

const shapeXml = ({
  id,
  name = 'Shape',
  x,
  y,
  cx,
  cy,
  fillColor,
  borderColor = null,
  borderWidth = 12700,
  prst = 'rect',
  shadow = false
}) => `
<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="${escapeXml(name)} ${id}"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${x}" y="${y}"/>
      <a:ext cx="${cx}" cy="${cy}"/>
    </a:xfrm>
    <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
    ${fillColor ? solidFillXml(fillColor) : '<a:noFill/>'}
    ${lineXml(borderColor, borderWidth)}
    ${shadow ? shadowXml() : ''}
  </p:spPr>
</p:sp>`;

const paragraphXml = (line, defaultStyle = {}) => {
  const lineData = typeof line === 'object' && line !== null ? line : { text: line };
  const fontSize = lineData.fontSize || defaultStyle.fontSize || 1800;
  const bold = Boolean(lineData.bold || defaultStyle.bold);
  const color = lineData.color || defaultStyle.color || COLORS.body;
  const spaceAfter = lineData.spaceAfter ?? defaultStyle.spaceAfter ?? 700;

  return `
<a:p>
  <a:pPr><a:spcAft><a:spcPts val="${spaceAfter}"/></a:spcAft></a:pPr>
  <a:r>
    <a:rPr lang="en-US" sz="${fontSize}"${bold ? ' b="1"' : ''}>
      ${solidFillXml(color)}
      <a:latin typeface="Aptos"/>
    </a:rPr>
    <a:t>${escapeXml(lineData.text || '')}</a:t>
  </a:r>
</a:p>`;
};

const textBoxXml = ({
  id,
  name = 'Text',
  x,
  y,
  cx,
  cy,
  lines = [],
  fontSize = 1800,
  color = COLORS.body,
  boldFirst = false,
  fillColor = null,
  borderColor = null,
  prst = 'rect',
  margin = 91440,
  shadow = false
}) => `
<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="${escapeXml(name)} ${id}"/>
    <p:cNvSpPr txBox="1"/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${x}" y="${y}"/>
      <a:ext cx="${cx}" cy="${cy}"/>
    </a:xfrm>
    <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
    ${fillColor ? solidFillXml(fillColor) : '<a:noFill/>'}
    ${lineXml(borderColor)}
    ${shadow ? shadowXml() : ''}
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="square" lIns="${margin}" tIns="${margin}" rIns="${margin}" bIns="${margin}"/>
    <a:lstStyle/>
    ${lines.map((line, index) => paragraphXml(line, {
    fontSize,
    color,
    bold: boldFirst && index === 0
  })).join('')}
  </p:txBody>
</p:sp>`;

const slideShellXml = (content) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${content}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const headerXml = (title, kicker = 'Karya AI Growth Plan') => `
${shapeXml({ id: 2, name: 'Background', x: 0, y: 0, cx: SLIDE.width, cy: SLIDE.height, fillColor: COLORS.bg })}
${shapeXml({ id: 3, name: 'Top Accent', x: 0, y: 0, cx: SLIDE.width, cy: 152400, fillColor: COLORS.blue })}
${textBoxXml({
    id: 4,
    name: 'Kicker',
    x: 548640,
    y: 274320,
    cx: 3657600,
    cy: 274320,
    lines: [{ text: kicker.toUpperCase(), fontSize: 1050, bold: true, color: COLORS.blueDark, spaceAfter: 0 }],
    margin: 0
  })}
${textBoxXml({
    id: 5,
    name: 'Title',
    x: 548640,
    y: 548640,
    cx: 7315200,
    cy: 731520,
    lines: [{ text: title, fontSize: 2850, bold: true, color: COLORS.ink, spaceAfter: 0 }],
    margin: 0
  })}`;

const coverSlideXml = ({ title, lines = [] }) => slideShellXml(`
${shapeXml({ id: 2, name: 'Cover Background', x: 0, y: 0, cx: SLIDE.width, cy: SLIDE.height, fillColor: COLORS.navy })}
${shapeXml({ id: 3, name: 'Cover Accent', x: 0, y: 0, cx: SLIDE.width, cy: 177800, fillColor: COLORS.cyan })}
${shapeXml({ id: 4, name: 'Cover Side Accent', x: 8229600, y: 0, cx: 914400, cy: SLIDE.height, fillColor: COLORS.blue })}
${shapeXml({ id: 5, name: 'Cover Soft Block', x: 6400800, y: 914400, cx: 1828800, cy: 3200400, fillColor: COLORS.blueDark, borderColor: COLORS.blueDark, prst: 'roundRect' })}
${shapeXml({ id: 6, name: 'Cover Tag', x: 548640, y: 640080, cx: 1280160, cy: 365760, fillColor: COLORS.blue, borderColor: COLORS.blue, prst: 'roundRect' })}
${textBoxXml({
    id: 7,
    name: 'Cover Tag Text',
    x: 594360,
    y: 704088,
    cx: 1188720,
    cy: 237744,
    lines: [{ text: 'KARYA AI', fontSize: 1050, bold: true, color: COLORS.white, spaceAfter: 0 }],
    margin: 0
  })}
${textBoxXml({
    id: 8,
    name: 'Cover Title',
    x: 548640,
    y: 1280160,
    cx: 6217920,
    cy: 1463040,
    lines: [{ text: title, fontSize: 3800, bold: true, color: COLORS.white, spaceAfter: 0 }],
    margin: 0
  })}
${textBoxXml({
    id: 9,
    name: 'Cover Details',
    x: 548640,
    y: 2926080,
    cx: 5577840,
    cy: 1097280,
    lines: lines.map((line, index) => ({
      text: line,
      fontSize: index === 0 ? 1850 : 1500,
      bold: index === 0,
      color: index === 0 ? COLORS.white : 'CBD5E1',
      spaceAfter: 900
    })),
    margin: 0
  })}
${textBoxXml({
    id: 10,
    name: 'Cover Footer',
    x: 548640,
    y: 4572000,
    cx: 4572000,
    cy: 274320,
    lines: [{ text: 'Plan, project recommendations, and roadmap', fontSize: 1150, color: '94A3B8', spaceAfter: 0 }],
    margin: 0
  })}
`);

const standardSlideXml = ({ title, lines = [], kicker }) => slideShellXml(`
${headerXml(title, kicker)}
${shapeXml({ id: 6, name: 'Main Card', x: 548640, y: 1356360, cx: 8046720, cy: 3291840, fillColor: COLORS.card, borderColor: COLORS.border, prst: 'roundRect', shadow: true })}
${shapeXml({ id: 7, name: 'Card Accent', x: 548640, y: 1356360, cx: 91440, cy: 3291840, fillColor: COLORS.green, borderColor: COLORS.green, prst: 'rect' })}
${textBoxXml({
    id: 8,
    name: 'Main Content',
    x: 777240,
    y: 1569720,
    cx: 7315200,
    cy: 2796540,
    lines: lines.map((line, index) => ({
      text: line,
      fontSize: index === 0 ? 1650 : 1450,
      bold: index === 0,
      color: index === 0 ? COLORS.slate : COLORS.body,
      spaceAfter: 850
    })),
    margin: 0
  })}
`);

const helpSlideXml = ({ title, cards = [], lines = [] }) => {
  const visibleCards = cards.length
    ? cards.slice(0, 4)
    : lines.slice(0, 4).map((line) => ({ title: line, body: [] }));
  const positions = [
    { x: 548640, y: 1417320 },
    { x: 4754880, y: 1417320 },
    { x: 548640, y: 3048000 },
    { x: 4754880, y: 3048000 }
  ];
  const accents = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.cyan];

  return slideShellXml(`
${headerXml(title, 'Business opportunity areas')}
${visibleCards.map((card, index) => {
    const pos = positions[index];
    const bodyLines = (card.body || []).filter(Boolean).slice(0, 2);
    return `
${shapeXml({ id: 10 + (index * 4), name: 'Help Card', x: pos.x, y: pos.y, cx: 3657600, cy: 1280160, fillColor: COLORS.card, borderColor: COLORS.border, prst: 'roundRect', shadow: true })}
${shapeXml({ id: 11 + (index * 4), name: 'Help Accent', x: pos.x, y: pos.y, cx: 3657600, cy: 91440, fillColor: accents[index], borderColor: accents[index], prst: 'rect' })}
${textBoxXml({
      id: 12 + (index * 4),
      name: 'Help Card Text',
      x: pos.x + 182880,
      y: pos.y + 198120,
      cx: 3291840,
      cy: 914400,
      lines: [
        { text: card.title, fontSize: 1450, bold: true, color: COLORS.ink, spaceAfter: 450 },
        ...bodyLines.map((body) => ({ text: body, fontSize: 1180, color: COLORS.body, spaceAfter: 350 }))
      ],
      margin: 0
    })}`;
  }).join('')}
`);
};

const projectSlideXml = ({ title, lines = [] }) => slideShellXml(`
${shapeXml({ id: 2, name: 'Project Background', x: 0, y: 0, cx: SLIDE.width, cy: SLIDE.height, fillColor: COLORS.bg })}
${shapeXml({ id: 3, name: 'Project Left Rail', x: 0, y: 0, cx: 457200, cy: SLIDE.height, fillColor: COLORS.navy })}
${shapeXml({ id: 4, name: 'Project Tag', x: 731520, y: 548640, cx: 2103120, cy: 365760, fillColor: COLORS.greenLight, borderColor: COLORS.greenLight, prst: 'roundRect' })}
${textBoxXml({
    id: 5,
    name: 'Project Tag Label',
    x: 822960,
    y: 609600,
    cx: 1910240,
    cy: 182880,
    lines: [{ text: 'RECOMMENDED PROJECT', fontSize: 950, bold: true, color: '047857', spaceAfter: 0 }],
    margin: 0
  })}
${textBoxXml({
    id: 6,
    name: 'Project Title',
    x: 731520,
    y: 1036320,
    cx: 7589520,
    cy: 914400,
    lines: [{ text: title, fontSize: 2850, bold: true, color: COLORS.ink, spaceAfter: 0 }],
    margin: 0
  })}
${shapeXml({ id: 7, name: 'Project Card', x: 731520, y: 2095500, cx: 7406640, cy: 2286000, fillColor: COLORS.card, borderColor: COLORS.border, prst: 'roundRect', shadow: true })}
${shapeXml({ id: 8, name: 'Project Card Accent', x: 731520, y: 2095500, cx: 121920, cy: 2286000, fillColor: COLORS.blue, borderColor: COLORS.blue, prst: 'rect' })}
${textBoxXml({
    id: 9,
    name: 'Project Content',
    x: 1005840,
    y: 2316480,
    cx: 6675120,
    cy: 1828800,
    lines: lines.slice(0, 5).map((line, index) => ({
      text: line,
      fontSize: index === 0 ? 1500 : 1280,
      bold: index === 0,
      color: index === 0 ? COLORS.slate : COLORS.body,
      spaceAfter: 700
    })),
    margin: 0
  })}
`);

const roadmapSlideXml = ({ title, timeline = [], lines = [] }) => {
  const items = timeline.length
    ? timeline.slice(0, 3)
    : [
      { phase: '30 days', focus: lines[0] || 'Start', actions: lines.slice(1, 3) },
      { phase: '60 days', focus: lines[3] || 'Build', actions: lines.slice(4, 6) },
      { phase: '90 days', focus: lines[6] || 'Scale', actions: lines.slice(7, 9) }
    ];
  const colors = [COLORS.blue, COLORS.green, COLORS.amber];

  return slideShellXml(`
${headerXml(title, 'Execution roadmap')}
${items.map((item, index) => {
    const x = 548640 + (index * 2804160);
    const actions = (item.actions || []).slice(0, 3);
    return `
${shapeXml({ id: 20 + (index * 5), name: 'Roadmap Column', x, y: 1432560, cx: 2529840, cy: 2926080, fillColor: COLORS.card, borderColor: COLORS.border, prst: 'roundRect', shadow: true })}
${shapeXml({ id: 21 + (index * 5), name: 'Roadmap Accent', x, y: 1432560, cx: 2529840, cy: 137160, fillColor: colors[index], borderColor: colors[index], prst: 'rect' })}
${textBoxXml({
      id: 22 + (index * 5),
      name: 'Roadmap Text',
      x: x + 182880,
      y: 1676400,
      cx: 2164080,
      cy: 2346960,
      lines: [
        { text: item.phase || `${(index + 1) * 30} days`, fontSize: 1800, bold: true, color: COLORS.ink, spaceAfter: 650 },
        { text: item.focus || '', fontSize: 1280, bold: true, color: COLORS.slate, spaceAfter: 650 },
        ...actions.map((action) => ({ text: `- ${action}`, fontSize: 1120, color: COLORS.body, spaceAfter: 500 }))
      ].filter((line) => line.text),
      margin: 0
    })}`;
  }).join('')}
`);
};

const nextStepSlideXml = ({ title, lines = [] }) => slideShellXml(`
${shapeXml({ id: 2, name: 'Next Background', x: 0, y: 0, cx: SLIDE.width, cy: SLIDE.height, fillColor: COLORS.navy })}
${shapeXml({ id: 3, name: 'Next Accent', x: 0, y: 0, cx: SLIDE.width, cy: 152400, fillColor: COLORS.green })}
${shapeXml({ id: 4, name: 'Next Card', x: 914400, y: 960120, cx: 7315200, cy: 3200400, fillColor: COLORS.card, borderColor: COLORS.card, prst: 'roundRect', shadow: true })}
${textBoxXml({
    id: 5,
    name: 'Next Title',
    x: 1188720,
    y: 1280160,
    cx: 6766560,
    cy: 731520,
    lines: [{ text: title, fontSize: 3200, bold: true, color: COLORS.ink, spaceAfter: 0 }],
    margin: 0
  })}
${shapeXml({ id: 6, name: 'Next Divider', x: 1188720, y: 2133600, cx: 1097280, cy: 76200, fillColor: COLORS.blue, borderColor: COLORS.blue, prst: 'rect' })}
${textBoxXml({
    id: 7,
    name: 'Next Content',
    x: 1188720,
    y: 2438400,
    cx: 6217920,
    cy: 1219200,
    lines: lines.map((line, index) => ({
      text: line,
      fontSize: index === 0 ? 1700 : 1450,
      bold: index === 0,
      color: index === 0 ? COLORS.slate : COLORS.body,
      spaceAfter: 850
    })),
    margin: 0
  })}
`);

const GAP_AREAS = ['awareness', 'discovery', 'connect', 'qualify', 'convert', 'retain'];

const formatGapAreaTitle = (area) => String(area || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const getSortedGapScoreLines = (gapScores = {}) => {
  return GAP_AREAS
    .map((area) => ({
      area,
      score: Number(gapScores?.[area]?.score),
      signals: Array.isArray(gapScores?.[area]?.signals) ? gapScores[area].signals : []
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score)
    .map((item, index) => {
      const label = `${index + 1}. ${formatGapAreaTitle(item.area)}: ${item.score}/10`;
      const signalText = item.signals.find((signal) => (
        signal && !/^not enough evidence yet\.?$/i.test(String(signal).trim())
      ));
      const signal = signalText ? ` - ${signalText}` : '';
      return `${label}${signal}`;
    });
};

const slideXml = (slide, index) => {
  if (slide.type === 'cover' || index === 0) return coverSlideXml(slide);
  if (slide.type === 'help') return helpSlideXml(slide);
  if (slide.type === 'project') return projectSlideXml(slide);
  if (slide.type === 'roadmap') return roadmapSlideXml(slide);
  if (slide.type === 'next') return nextStepSlideXml(slide);
  return standardSlideXml(slide);
};

const buildSlides = ({ state, plan }) => {
  const companyName = state.businessProfile?.companyName || state.identity?.name || 'Business';
  const helpAreas = state.businessReview?.helpAreas || [];
  const projects = plan.recommendedProjects || [];
  const gapScoreLines = getSortedGapScoreLines(state.gapScores);

  const slides = [
    {
      type: 'cover',
      title: `Karya AI x ${companyName}`,
      lines: [
        '30-60-90 day growth plan',
        state.goal?.description ? `Goal: ${state.goal.description}` : '',
        `Prepared on ${new Date().toLocaleDateString('en-US')}`
      ].filter(Boolean)
    },
    {
      type: 'snapshot',
      title: 'Business Snapshot',
      lines: [
        state.businessReview?.summary || plan.summary,
        state.businessProfile?.industry ? `Industry: ${state.businessProfile.industry}` : '',
        state.businessProfile?.targetCustomer ? `Target customer: ${state.businessProfile.targetCustomer}` : ''
      ].filter(Boolean)
    },
    {
      type: 'gap_scores',
      title: 'Gap Score Analysis',
      lines: gapScoreLines
    },
    {
      type: 'help',
      title: 'Where Karya AI Can Help',
      cards: helpAreas.slice(0, 4).map((area) => ({
        title: area.title,
        body: [
          area.project?.gapScore ? `Gap score: ${area.project.gapScore}/10` : '',
          area.project?.matchedSubjects?.length ? `Matched subjects: ${area.project.matchedSubjects.slice(0, 3).join(', ')}` : '',
          area.whyItMatters || '',
          area.project?.title ? `Project: ${area.project.title}` : ''
        ].filter(Boolean)
      })),
      lines: helpAreas.length
        ? helpAreas.flatMap((area, index) => [
          `${index + 1}. ${area.title}`,
          area.project ? `Project: ${area.project.title}` : '',
          area.whyItMatters || ''
        ]).filter(Boolean)
        : (state.gapScores?.topGaps || []).map((gap, index) => `${index + 1}. ${gap}`)
    },
    ...projects.map((project) => ({
      type: 'project',
      title: `Project: ${project.title}`,
      lines: [
        project.gapArea ? `Gap area: ${formatGapAreaTitle(project.gapArea)}${project.gapScore ? ` (${project.gapScore}/10)` : ''}` : '',
        project.matchedSubjects?.length ? `Matched subjects: ${project.matchedSubjects.slice(0, 4).join(', ')}` : '',
        project.rationale,
        project.expectedOutput ? `Expected output: ${project.expectedOutput}` : '',
        project.phase ? `Timing: ${project.phase}` : '',
        project.marketplaceUrl ? `Marketplace: ${project.marketplaceUrl}` : ''
      ].filter(Boolean)
    })),
    {
      type: 'roadmap',
      title: '30-60-90 Roadmap',
      timeline: plan.timeline || [],
      lines: (plan.timeline || []).flatMap((item) => [
        `${item.phase}: ${item.focus}`,
        ...(item.actions || []).slice(0, 2).map((action) => `- ${action}`)
      ])
    },
    {
      type: 'next',
      title: 'Next Step',
      lines: [
        plan.nextStep || 'Start with the first recommended project.',
        projects[0]?.title ? `Start here: ${projects[0].title}` : ''
      ].filter(Boolean)
    }
  ];

  return slides.map((slide) => ({
    type: slide.type,
    title: slide.title,
    cards: slide.cards,
    timeline: slide.timeline,
    lines: slide.lines.map((line) => String(line || '').slice(0, 220)).slice(0, 12)
  }));
};

const createPresentationXml = (slideCount) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId${slideCount + 1}"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    ${Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')}
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

const createPresentationRels = (slideCount) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}
  <Relationship Id="rId${slideCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
</Relationships>`;

const createSlideRels = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const createSlideMasterXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr marL="0" indent="0"><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr marL="0" indent="0"><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`;

const createSlideMasterRels = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const createSlideLayoutXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const createSlideLayoutRels = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const createThemeXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Karya AI">
  <a:themeElements>
    <a:clrScheme name="Karya AI">
      <a:dk1><a:srgbClr val="111827"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="0F172A"/></a:dk2>
      <a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="2563EB"/></a:accent1>
      <a:accent2><a:srgbClr val="10B981"/></a:accent2>
      <a:accent3><a:srgbClr val="F59E0B"/></a:accent3>
      <a:accent4><a:srgbClr val="38BDF8"/></a:accent4>
      <a:accent5><a:srgbClr val="64748B"/></a:accent5>
      <a:accent6><a:srgbClr val="1D4ED8"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
      <a:folHlink><a:srgbClr val="1D4ED8"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Karya AI">
      <a:majorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Karya AI">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const createContentTypes = (slideCount) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
</Types>`;

const createPlanPptx = ({ state, plan }) => {
  const slides = buildSlides({ state, plan });
  const companyName = state.businessProfile?.companyName || 'business';
  const fileName = `${sanitizeFileName(companyName)}-growth-plan.pptx`;

  const entries = [
    { name: '[Content_Types].xml', data: createContentTypes(slides.length) },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
    },
    { name: 'ppt/presentation.xml', data: createPresentationXml(slides.length) },
    { name: 'ppt/_rels/presentation.xml.rels', data: createPresentationRels(slides.length) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: createSlideMasterXml() },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: createSlideMasterRels() },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: createSlideLayoutXml() },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: createSlideLayoutRels() },
    { name: 'ppt/theme/theme1.xml', data: createThemeXml() },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Karya AI Growth Plan</dc:title><dc:creator>Karya AI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Karya AI</Application><Slides>${slides.length}</Slides></Properties>` },
    ...slides.map((slide, index) => ({
      name: `ppt/slides/slide${index + 1}.xml`,
      data: slideXml(slide, index)
    })),
    ...slides.map((_, index) => ({
      name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      data: createSlideRels()
    }))
  ];

  const buffer = createZip(entries);

  return {
    fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    base64: buffer.toString('base64')
  };
};

module.exports = {
  createPlanPptx
};
