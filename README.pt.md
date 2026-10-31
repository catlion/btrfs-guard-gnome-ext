# Btrfs Guard — extensão GNOME Shell

Indicador no painel que monitoriza o **espaço não alocado** dos seus sistemas de ficheiros btrfs e ajuda a recuperá-lo antes que as escritas bloqueiem.

<p align="center">
  <img src="docs/menu.png" alt="Menu do painel com o espaço não alocado e as ações de recuperação" height="300">
  <img src="docs/usage.png" alt="Diálogo de utilização do sistema de ficheiros" height="300">
</p>

## Como funciona

O btrfs não devolve o espaço para "não alocado" quando os ficheiros são apagados. O espaço é atribuído em **chunks** de tamanho fixo (normalmente 1 GiB para dados, 256 MiB para metadados). Quando o btrfs fica sem espaço não alocado, não consegue alocar novos chunks — os metadados deixam de poder crescer e as escritas bloqueiam, mesmo que `df` ainda pareça normal. Recuperar a partir desse ponto é difícil.

O Btrfs Guard monitoriza continuamente o espaço não alocado e oferece equilíbrio com um clique:

1. **Monitorizar** — para cada ponto de montagem configurado, a extensão:
   - resolve o UUID do btrfs e o dispositivo de suporte uma única vez (através de `findmnt`), e depois
   - lê os contadores de alocação do sysfs (`/sys/fs/btrfs/<uuid>/allocation/*`) e o tamanho do dispositivo a partir de `/sys/class/block/<dev>/size` — sem chamadas à CLI `btrfs` e sem necessidade de root, pelo que consultar a cada 30 s é praticamente gratuito.
   - *Não alocado = tamanho do dispositivo − Σ disk_total dos chunks de dados/metadados/sistema.*
2. **Alertar** — quando o espaço não alocado desce abaixo de **1 GiB**, a etiqueta do painel fica vermelha com um ícone de aviso e é lançada uma notificação **crítica**; volta a alertar no máximo a cada 30 minutos até o espaço ser recuperado.
3. **Recuperar** — o menu executa `pkexec btrfs balance start -dusage=N <mount>`:
   - `-dusage=0` liberta chunks completamente vazios,
   - `-dusage=N` (predefinido **60**, configurável) compacta chunks parcialmente utilizados e devolve o espaço livre ao conjunto não alocado.
   O equilíbrio requer o limite de utilização dos chunks — valores mais baixos são seguros mas recuperam menos; valores mais altos recuperam mais mas reescrevem mais dados.
4. **Inspecionar** — um item de menu mostra `btrfs filesystem usage` para o ponto de montagem numa janela com deslocamento.

## Definições

Abra através da aplicação *Extensões* → Btrfs Guard → ícone de engrenagem (ou `gnome-extensions prefs btrfs-guard@ak0.org`):

- **Partições monitorizadas** — lista de pontos de montagem btrfs; um indicador no painel por cada um. Adicione manualmente ou clique em *Detetar montagens btrfs* para preencher automaticamente todos os sistemas de ficheiros btrfs a partir de `findmnt` (uma montagem por sistema de ficheiros; as montagens obsoletas sem UUID são ignoradas).
- **Limite de utilização do chunk** — o `N` em `balance -dusage=N` (0–100 %, predefinido 60).

As definições são guardadas no GSettings em `org.gnome.shell.extensions.btrfs-guard`.

## Traduções

As strings visíveis para o utilizador estão marcadas com gettext (domínio `btrfs-guard`). O russo (`ru`) já está incluído; para adicionar um idioma, crie `po/<lang>.po` a partir de `po/btrfs-guard.pot` (atualize com `xgettext --from-code=UTF-8 --keyword=_ -o po/btrfs-guard.pot extension.js prefs.js`), traduza e depois compile e instale:

```sh
mkdir -p locale/<lang>/LC_MESSAGES
msgfmt po/<lang>.po -o locale/<lang>/LC_MESSAGES/btrfs-guard.mo
```

## Instalar a partir do código-fonte

```sh
git clone https://github.com/catlion/btrfs-guard-gnome-ext.git
cd btrfs-guard-gnome-ext
glib-compile-schemas schemas
cp -r . ~/.local/share/gnome-shell/extensions/btrfs-guard@ak0.org
# termine a sessão / reinicie o GNOME Shell para carregar
```

## Requisitos

- GNOME Shell 48 ou posterior
- btrfs-progs (`/usr/bin/btrfs`) e polkit (`pkexec`) — usados apenas nas ações de equilíbrio/utilização
