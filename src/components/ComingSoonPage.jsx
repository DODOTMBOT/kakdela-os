// Раздел, который ещё не реализован: название, тематическая иконка и короткое пояснение.
export default function ComingSoonPage({ title, Icon }) {
  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <section className="soon">
        <span className="soon-icon">
          <Icon size={30} />
        </span>
        <h2>В стадии разработки</h2>
        <p>Этот раздел скоро появится в ЕСУ KAKDELA</p>
      </section>
    </>
  );
}
