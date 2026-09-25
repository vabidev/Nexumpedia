<?php
declare(strict_types=1);

require_once __DIR__ . '/app/view.php';

render_header('Sobre a Nexumpedia');
?>
<div class="page">
  <?php render_public_sidebar(); ?>
  <main class="article">
    <header class="article-header"><h1>Sobre a Nexumpedia</h1></header>
    <p class="lead">A Nexumpedia é uma enciclopédia digital em desenvolvimento, com conteúdo criado e mantido por administradores e colaboradores autorizados.</p>
    <h2>Proposta editorial</h2>
    <p>Leitores podem consultar o conteúdo público. A edição, porém, fica restrita a contas autorizadas, com rascunhos, revisão, publicação e histórico de versões.</p>
    <h2>Identidade</h2>
    <p>O projeto utiliza uma interface clássica de enciclopédia para manter a leitura familiar, mas possui nome, marca, cores e elementos gráficos próprios.</p>
    <footer class="footer">Nexumpedia — Conhecimento em conexão.</footer>
  </main>
  <aside class="toc-side"><div class="nav-title">Nesta página</div><a href="#proposta">Proposta</a><a href="#identidade">Identidade</a></aside>
</div>
<?php render_footer(); ?>
