'use client';

import { useEffect, useState } from 'react';

type AxisKey = 'a' | 'd1' | 'h' | 'd2';
type Axis = {
  key: AxisKey;
  symbol: string;
  name: string;
  zh: string;
  prompt: string;
  lowCode: string;
  lowLabel: string;
  highCode: string;
  highLabel: string;
};

type Personality = {
  name: string;
  family: string;
  tagline: string;
  description: string;
  advice: string;
  image?: string;
};

const axes: Axis[] = [
  { key: 'a', symbol: 'A', name: 'Attention Drift', zh: '注意力偏移', prompt: '注意力多容易偏离当前目标？', lowCode: 'S', lowLabel: 'Stable 稳定', highCode: 'F', highLabel: 'Floating 漂移' },
  { key: 'd1', symbol: 'D¹', name: 'Deadline Drive', zh: '截止线驱动', prompt: '行动是均匀推进，还是临近节点爆发？', lowCode: 'E', lowLabel: 'Even 均匀', highCode: 'B', highLabel: 'Burst 爆发' },
  { key: 'h', symbol: 'H', name: 'Hyperfocus', zh: '高沉浸能力', prompt: '进入任务后能持续多深？', lowCode: 'L', lowLabel: 'Light 轻切', highCode: 'D', highLabel: 'Deep 深潜' },
  { key: 'd2', symbol: 'D²', name: 'Direction Recovery', zh: '方向恢复', prompt: '偏离之后，能否找回正确下一步？', lowCode: 'M', lowLabel: 'Missing 迷航', highCode: 'R', highLabel: 'Recover 回正' },
];

const personalities: Record<string, Personality> = {
  FBDR: { name: '火箭蒲公英', family: 'FB · 点火组', tagline: '会飘，但 DDL 能把自己点回来', description: '灵感与切换很多，临近检查点时爆发力强；进入状态后可以深度沉浸，也较容易找回原目标。', advice: '把大截止线拆成短检查点，用一句“下一步”提前点火，不必等到最后一刻。', image: '/personas/fbdr.jpg' },
  FBDM: { name: '反向流星', family: 'FB · 点火组', tagline: '最后一刻亮得惊人，却总从目标旁边飞过', description: '拥有强爆发和深度投入能力，但偏离后容易在错误方向继续加速，忙了很久才发现目标已经错位。', advice: '每次冲刺前锁定唯一目标；检测到偏离时直接重现原目标和唯一下一步。', image: '/personas/fbdm.jpg' },
  FBLR: { name: '弹跳火花', family: 'FB · 点火组', tagline: '注意力乱跳，但还能自己弹回来', description: '习惯用短冲刺推进，注意力切换频繁但恢复速度快；轻量提醒通常已经足够。', advice: '采用10–15分钟短冲刺和单击回正，减少冗长复盘对节奏的打断。', image: '/personas/fblr.jpg' },
  FBLM: { name: '走神弹珠', family: 'FB · 点火组', tagline: '一碰就偏，越滚越远', description: '容易被新刺激带走，连续上下文较短；偏离后还可能追着下一个刺激继续移动。', advice: '减少选择，只显示一个可执行动作，并在偏离早期提供明确的回归入口。', image: '/personas/fblm.jpg' },
  FEDR: { name: '回游水母', family: 'FE · 漫游组', tagline: '看似随波漂浮，却会慢慢游回任务深处', description: '启动和推进相对均匀，注意力会漂移，但一旦沉入任务便能持续较久，并能逐渐游回主线。', advice: '使用温和启动和较长专注区间，把恢复提示做成方向提示而不是警报。', image: '/personas/fedr.jpg' },
  FEDM: { name: '梦游潜水员', family: 'FE · 漫游组', tagline: '能专注，但常常忘了为什么开始', description: '可以长时间沉浸，也不依赖最后期限爆发；风险是专注在错误对象上却迟迟没有察觉。', advice: '始终固定显示任务目的，并在深度区间之间安排极短的方向确认。', image: '/personas/fedm.jpg' },
  FELR: { name: '回旋风筝', family: 'FE · 漫游组', tagline: '被风带走一点，手里的线总能把自己拉回', description: '偏移与轻切较多，但推进节奏稳定、恢复速度快，适合保留探索空间的柔性计划。', advice: '用可见的任务面包屑保留上下文，让提醒只负责把线拉回来。', image: '/personas/felr.jpg' },
  FELM: { name: '云端迷路人', family: 'FE · 漫游组', tagline: '温柔地走神，安静地迷路', description: '不会剧烈爆发或频繁报警式切换，却可能在缓慢浏览和次要任务中悄悄失去方向。', advice: '设置低打扰的阶段检查点，用清晰进度变化识别“看似在做、实际未推进”。', image: '/personas/felm.jpg' },
  SBDR: { name: '蓄能钻头', family: 'SB · 跃迁组', tagline: '平时不动声色，启动后会一直钻到问题核心', description: '注意力较稳定，受到检查点驱动后会迅速进入深度执行，偏离后也能重新锁定核心。', advice: '设计明确的启动仪式和中间检查点，把强爆发提前释放。', image: '/personas/sbdr.jpg' },
  SBDM: { name: '孤岛冲刺手', family: 'SB · 跃迁组', tagline: '能冲刺，但切出后容易断联', description: '进入任务后稳定而深入，也能快速推进；一旦上下文被打断，却可能很难回到原来的执行位置。', advice: '保护深度工作区，并在每次暂停前自动保存“回来后的第一步”。', image: '/personas/sbdm.jpg' },
  SBLR: { name: '节拍跑酷客', family: 'SB · 跃迁组', tagline: '一段一段向前跳，踩空也能立刻接上拍子', description: '注意力相对稳定，擅长短周期爆发和轻量切换，失误后能够快速接回原有节奏。', advice: '使用番茄钟式节拍和清晰检查点，让每段冲刺都有可见落点。', image: '/personas/sblr.jpg' },
  SBLM: { name: '直线脱轨者', family: 'SB · 跃迁组', tagline: '表面稳定，但一偏就很难回来', description: '通常沿直线推进，短周期执行效率不错；风险是偏离不常发生，但发生后会造成明显断线。', advice: '重点不是频繁提醒，而是在脱轨早期保存上下文并提供一键续接。', image: '/personas/sblm.jpg' },
  SEDR: { name: '定心陀螺', family: 'SE · 巡航组', tagline: '越转越稳，越做越深，始终守住中心', description: '推进节奏均匀、注意力稳定、沉浸较深且恢复良好，是持续执行型，但仍可能出现过度专注。', advice: '保留清晰终点和休息边界，避免稳定沉浸变成无止境加码。', image: '/personas/sedr.jpg' },
  SEDM: { name: '静默矿工', family: 'SE · 巡航组', tagline: '可以安静挖很久，只是偶尔挖错方向', description: '能够长期稳定工作，也不依赖临期爆发；最大风险是沿错误方向持续深挖而不自知。', advice: '减少过程打扰，但必须安排低频、高价值的方向核验。', image: '/personas/sedm.jpg' },
  SELR: { name: '轨迹邮差', family: 'SE · 巡航组', tagline: '按固定站点推进，偏一步也会回到下一站', description: '节奏稳定、轻量切换、恢复快速，擅长按站点持续交付，不需要强刺激才能行动。', advice: '把任务整理成等距小站点，用批量推进和清晰完成反馈保持节奏。', image: '/personas/selr.jpg' },
  SELM: { name: '慢拍树懒', family: 'SE · 巡航组', tagline: '不太乱，也不太停，只是每一步都慢半拍', description: '很少剧烈偏离，推进也较均匀，但上下文较浅、恢复较慢，容易出现长期低速移动。', advice: '缩小启动动作、放大进度反馈，并在停滞时直接给出最小下一步。', image: '/personas/selm.jpg' },
};

const defaults: Record<AxisKey, number> = { a: 74, d1: 68, h: 81, d2: 72 };

export default function Home() {
  const [scores, setScores] = useState(defaults);
  const [resultCode, setResultCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setShowSplash(false);
      return;
    }

    const dismiss = () => setShowSplash(false);
    const timer = window.setTimeout(dismiss, 800);
    window.addEventListener('keydown', dismiss, { once: true });
    window.addEventListener('scroll', dismiss, { once: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('scroll', dismiss);
    };
  }, []);

  const personality = resultCode ? personalities[resultCode] : null;

  function revealResult() {
    const nextCode = axes
      .map((axis) => scores[axis.key] >= 50 ? axis.highCode : axis.lowCode)
      .join('');
    setResultCode(nextCode);
    setCopied(false);
  }

  function resetExperience() {
    setScores(defaults);
    setResultCode(null);
    setCopied(false);
  }

  async function copyResult() {
    if (!resultCode || !personality) return;
    const text = `我的 ADTI 注意力人格：${resultCode} ${personality.name}｜${personality.tagline}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      {showSplash && (
        <button className="brand-splash" type="button" onClick={() => setShowSplash(false)} aria-label="跳过 FocusTrail 开屏动画">
          <span className="splash-inner">
            <img src="/focustrail-logo.svg" alt="" />
            <strong>FOCUSTRAIL</strong>
            <span className="splash-slogan"><b>A</b>ttention <b>D</b>rifts. <b>H</b>ere’s <b>D</b>irection.</span>
          </span>
        </button>
      )}
      <main data-release="7">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="FocusTrail ADTI 首页">
          <img src="/focustrail-logo.svg" alt="" />
          <span>FOCUSTRAIL</span>
        </a>
        <span className="beta">ADTI · 互动体验</span>
      </header>

      <section id="top" className="hero">
        <p className="eyebrow">Attention Drifts. Here’s Direction.</p>
        <h1>偏了吗？<br /><span>看看你的注意力会怎么走。</span></h1>
        <p className="adti-fullname"><strong>ADTI</strong><span>Attention Drift Type Indicator</span><em>注意力偏移类型指标</em></p>
        <p className="intro">FocusTrail 是面向大学生的 AI 执行恢复辅助工具：在分心或计划中断后，帮你回到清晰的下一步。选择四条行为轴的分数，再揭晓你的 ADTI 四字母人格；结果不是医学诊断。</p>
      </section>

      <section className="experience" aria-label="ADTI 四维人格体验">
        <div className="axes-panel">
          <div className="section-heading">
            <div>
              <p className="kicker">四维行为坐标</p>
              <h2>调出你的注意力轨迹</h2>
            </div>
            <button className="reset" type="button" onClick={resetExperience}>恢复示例</button>
          </div>

          <div className="axis-list">
            {axes.map((axis) => (
              <div className="axis" key={axis.key}>
                <div className="axis-copy">
                  <div className="axis-symbol">{axis.symbol}</div>
                  <div>
                    <strong>{axis.name}</strong>
                    <span>{axis.zh}</span>
                  </div>
                  <output>{scores[axis.key]}</output>
                </div>
                <p>{axis.prompt}</p>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={scores[axis.key]}
                  onChange={(event) => setScores((current) => ({ ...current, [axis.key]: Number(event.target.value) }))}
                  aria-label={`${axis.zh}分数`}
                  style={{ '--score': `${scores[axis.key]}%` } as React.CSSProperties}
                />
                <div className="poles">
                  <span><b>{axis.lowCode}</b>{axis.lowLabel}</span>
                  <small>50</small>
                  <span><b>{axis.highCode}</b>{axis.highLabel}</span>
                </div>
              </div>
            ))}
          </div>
          <button className="reveal" type="button" onClick={revealResult}>
            查看你的 ADTI 注意力人格
          </button>
        </div>

        <aside className="result" aria-live="polite">
          {resultCode && personality ? (
            <>
              <div className="result-topline">
                <span>你的注意力人格</span>
                <span className="family">{personality.family}</span>
              </div>
              <div className="code" aria-label={`人格代码 ${resultCode}`}>
                {resultCode.split('').map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}
              </div>

              <div className="portrait">
                {personality.image ? (
                  <img src={personality.image} alt={`${resultCode} ${personality.name} IP形象`} />
                ) : (
                  <div className="placeholder" aria-label={`${resultCode} IP形象待绘制`}>
                    <strong>{resultCode}</strong>
                    <span>IP 形象待绘制</span>
                  </div>
                )}
              </div>

              <p className="result-label">{resultCode}</p>
              <h2>{personality.name}</h2>
              <p className="tagline">{personality.tagline}</p>
              <p className="description">{personality.description}</p>
              <div className="advice">
                <span>FocusTrail 建议</span>
                <p>{personality.advice}</p>
              </div>
              <button className="share" type="button" onClick={copyResult}>{copied ? '已复制 ✓' : '复制我的人格结果'}</button>
              <a className="demo-link" href="https://focus-trail.vercel.app/" target="_blank" rel="noreferrer">
                用 FocusTrail 开始下一步 ↗
              </a>
            </>
          ) : (
            <div className="result-empty">
              <img src="/focustrail-logo.svg" alt="" />
              <p className="kicker">结果尚未生成</p>
              <h2>四个维度选好了吗？</h2>
              <p>确认分数后点击左侧按钮，再查看你的 ADTI 注意力人格。</p>
              <div className="empty-code" aria-hidden="true"><span>?</span><span>?</span><span>?</span><span>?</span></div>
            </div>
          )}
        </aside>
      </section>

      <footer>
        <div>
          <p><strong>ADTI</strong> · Attention Drift Type Indicator · 注意力偏移类型指标</p>
          <p>用注意力偏移、期限驱动、沉浸深度与方向恢复四条行为轴，描述你如何启动、偏离、沉浸与回正；结果不用于医学诊断。</p>
        </div>
        <div className="creator">
          <p><strong>Stella</strong> · FocusTrail 创始人</p>
          <nav aria-label="FocusTrail 项目链接">
            <a href="https://focus-trail.vercel.app/" target="_blank" rel="noreferrer">Web Demo ↗</a>
            <a href="https://github.com/lalalastella/FocusTrail" target="_blank" rel="noreferrer">GitHub / 联系 Stella ↗</a>
          </nav>
        </div>
      </footer>
      </main>
    </>
  );
}
