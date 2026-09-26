const h = await fetch("http://127.0.0.1:3847/").then((r) => r.text());
const m = h.match(/src="([^"]+)"/);
const js = m[1];
const t = await fetch("http://127.0.0.1:3847" + js).then((r) => r.text());
console.log({ js, len: t.length, isHtml: t.trimStart().startsWith("<!"), start: t.slice(0, 40) });
