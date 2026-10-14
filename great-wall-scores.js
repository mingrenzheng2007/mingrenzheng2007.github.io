// Ported from the miniprogram. Scores are research reference settings, not field assessments.
const baseline = {
  zhuanjiaolou: { completeness: 4.5, accessibility: 4.5, risk: 2, education: 5, remoteness: 1.5 },
  'mazhen-beacon': { completeness: 3.5, accessibility: 4, risk: 2.5, education: 4.5, remoteness: 2 },
  longwangmiao: { completeness: 4, accessibility: 3.5, risk: 3, education: 4.5, remoteness: 2.5 },
  'xinmin-tower': { completeness: 2, accessibility: 2.2, risk: 4, education: 3.2, remoteness: 4.2 },
  zhenqiangbao: { completeness: 3, accessibility: 2.8, risk: 4.2, education: 4.2, remoteness: 3.8 },
  huangfubao: { completeness: 2.6, accessibility: 2.8, risk: 3.6, education: 3.8, remoteness: 3.4 },
  qingshuibao: { completeness: 3.4, accessibility: 3.8, risk: 2.8, education: 4.4, remoteness: 2.4 },
  gushanbao: { completeness: 2.4, accessibility: 2.4, risk: 4, education: 3.7, remoteness: 4 },
  muguayuanbao: { completeness: 3.5, accessibility: 3.8, risk: 2.6, education: 4.2, remoteness: 2.6 },
  'mazhen-view': { completeness: 3.8, accessibility: 4.6, risk: 2, education: 4.4, remoteness: 1.4 }
}

const maxScore = 5

function clamp(value, min = 0, max = maxScore) {
  return Math.max(min, Math.min(max, Number(value) || 0))
}

function round(value) {
  return Math.round(clamp(value) * 10) / 10
}

function daysSince(ts) {
  if (!ts) return 999
  return Math.max(0, Math.floor((Date.now() - Number(ts)) / (24 * 60 * 60 * 1000)))
}

function getSiteRecords(site, records = []) {
  return records.filter((record) => record.siteId === site.id)
}

function getSitePublicItems(site, publicItems = []) {
  return publicItems.filter((item) => item.siteId === site.id)
}

function getPatrolScore(siteRecords) {
  const patrols = siteRecords.filter((record) => record.kind === 'patrol')
  if (!patrols.length) return 0
  const latest = Math.max(...patrols.map((record) => Number(record.createdAt) || 0))
  const age = daysSince(latest)
  if (age <= 7) return 5
  if (age <= 30) return 4
  if (age <= 90) return 3
  return 2
}

function hasPhoto(site, siteRecords, sitePublicItems) {
  return Boolean(
    site.imagePath ||
    siteRecords.some((record) => record.photoPath) ||
    sitePublicItems.some((item) => item.imageUrl)
  )
}

function storyCompleteness(site) {
  const storyLength = site.referenceStoryLength ?? String(site.story || '').length
  const tipLength = site.referenceTipLength ?? String(site.protectionTip || '').length
  let score = 1
  if (storyLength > 40) score += 1
  if (storyLength > 100) score += 1
  if (tipLength > 40) score += 1
  if (Array.isArray(site.tags) && site.tags.length >= 3) score += 0.5
  return clamp(score)
}

function buildProtectionScore(site, records = [], publicItems = []) {
  const base = baseline[site.id] || { completeness: 2.8, accessibility: 3, risk: 3, education: 3.5, remoteness: 3 }
  const siteRecords = getSiteRecords(site, records)
  const sitePublicItems = getSitePublicItems(site, publicItems)
  const patrolScore = getPatrolScore(siteRecords)
  const photoReady = hasPhoto(site, siteRecords, sitePublicItems)
  const publicCount = sitePublicItems.length
  const localPhotoCount = siteRecords.filter((record) => record.photoPath).length
  const recordCount = siteRecords.length
  const storyScore = storyCompleteness(site)

  const completeness = round(
    base.completeness * 0.55 +
    storyScore * 0.25 +
    (photoReady ? 0.8 : -0.5) +
    Math.min(recordCount, 3) * 0.18
  )
  const accessibility = round(base.accessibility)
  const risk = round(
    base.risk +
    (patrolScore <= 1 ? 0.4 : 0) +
    (!photoReady ? 0.3 : 0) -
    (patrolScore >= 4 ? 0.4 : 0)
  )
  const patrolFrequency = round(patrolScore)
  const education = round(
    base.education +
    (photoReady ? 0.25 : -0.2) +
    (publicCount ? 0.25 : 0)
  )

  const priorityRaw = risk * 0.36 + (maxScore - patrolFrequency) * 0.28 + (maxScore - completeness) * 0.2 + base.remoteness * 0.16
  const forgottenRaw = base.remoteness * 0.25 + risk * 0.22 + (maxScore - patrolFrequency) * 0.2 + (photoReady ? 0 : 1.2) + (publicCount ? 0 : 0.8) + (maxScore - accessibility) * 0.16
  const popularRaw = accessibility * 0.3 + completeness * 0.26 + education * 0.24 + patrolFrequency * 0.12 + (photoReady ? 0.5 : 0)

  const priority = priorityRaw >= 3.6 ? 'High' : priorityRaw >= 2.6 ? 'Medium' : 'Low'
  const priorityClass = priority === 'High' ? 'high' : priority === 'Medium' ? 'medium' : 'low'

  const reasons = []
  if (risk >= 4) reasons.push('Higher reference risk')
  if (patrolFrequency <= 1) reasons.push('No recent patrols')
  if (!photoReady) reasons.push('Photos needed')
  if (!publicCount) reasons.push('Few shared items')
  if (base.remoteness >= 3.8) reasons.push('Remote location')
  if (!reasons.length) reasons.push('Basic documentation is available')

  const metrics = [
    { key: 'completeness', label: 'Completeness', value: completeness, desc: 'Condition information, stories, photos, and records', tone: completeness >= 4 ? 'good' : completeness >= 2.8 ? 'medium' : 'weak' },
    { key: 'accessibility', label: 'Accessibility', value: accessibility, desc: 'Routes, entrances, and ease of access', tone: accessibility >= 4 ? 'good' : accessibility >= 2.8 ? 'medium' : 'weak' },
    { key: 'risk', label: 'Reference risk', value: risk, desc: 'Damage, litter, erosion, and missing patrols', tone: risk >= 4 ? 'risk' : risk >= 2.8 ? 'medium' : 'good' },
    { key: 'patrolFrequency', label: 'Patrol frequency', value: patrolFrequency, desc: 'Recent warden or volunteer patrol records', tone: patrolFrequency >= 4 ? 'good' : patrolFrequency >= 2 ? 'medium' : 'weak' },
    { key: 'education', label: 'Educational value', value: education, desc: 'Understanding the Great Wall network and community preservation', tone: education >= 4 ? 'good' : education >= 2.8 ? 'medium' : 'weak' }
  ].map((metric) => ({
    ...metric,
    percent: Math.round(metric.value * 20)
  }))

  return {
    siteId: site.id,
    priority,
    priorityClass,
    forgottenIndex: Math.round(forgottenRaw * 20),
    popularIndex: Math.round(popularRaw * 20),
    publicCount,
    localPhotoCount,
    recordCount,
    hasPhoto: photoReady,
    latestPatrolDays: daysSince(Math.max(0, ...siteRecords.filter((record) => record.kind === 'patrol').map((record) => Number(record.createdAt) || 0))),
    reasons,
    metrics
  }
}

function buildScoredSites(sites, records = [], publicItems = []) {
  return sites.map((site) => ({
    ...site,
    protectionScore: buildProtectionScore(site, records, publicItems)
  }))
}

export { buildProtectionScore, buildScoredSites };
