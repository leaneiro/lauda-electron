# Bienvenue dans <span class="wordmark">Lauda</span> 👋

<span class="wordmark">Lauda</span> est un éditeur Markdown à deux volets : vous écrivez à gauche et voyez le résultat mis en forme à droite, mis à jour pendant la saisie.

Ce document est sans titre, alors n’hésitez pas à faire des essais. Pour le conserver, enregistrez-le avec ⌘S ; sinon, fermez-le simplement. Vous pouvez rouvrir ce guide à tout moment depuis **Aide → Guide de bienvenue**.

## Écrire

Le texte peut être en **gras** (⌘B), en *italique* (⌘I) ou en `code`. Sélectionnez du texte et appuyez sur ⌘K pour en faire un [lien](https://daringfireball.net/projects/markdown/), ou collez une URL sur la sélection.

Tapez `->` ou `<-` en dehors du code et ils deviennent → et ←.

Tapez `(`, `[`, `*` ou `"` et le caractère fermant suit, avec le curseur entre les deux. Si du texte est sélectionné, la paire l’entoure.

> Les citations ressemblent à ceci.

## Listes

- Appuyez sur Retour à la fin d’un élément pour commencer le suivant
- Tab et Maj + Tab augmentent et réduisent le retrait
  - Comme celui-ci

1. Les listes numérotées continuent aussi
2. Et prennent automatiquement le numéro suivant

### Tâches

- [x] Ouvrir <span class="wordmark">Lauda</span>
- [ ] Écrire quelque chose de génial

## Code

```swift
struct Greeting {
    let name: String

    func sayHello() -> String {
        "Hello, \(name)!"
    }
}
```

## Tableaux

| Fonction              | Raccourci |
|:----------------------|:---------:|
| Éditeur uniquement    | ⌘1        |
| Éditeur et aperçu     | ⌘2        |
| Aperçu uniquement     | ⌘3        |
| Rechercher            | ⌘F        |
| Exporter au format PDF | ⇧⌘E      |

## Images

Faites glisser une image dans l’éditeur, ou collez une capture d’écran : elle est copiée à côté du document, et le Markdown est écrit pour vous. Enregistrez d’abord le document, pour que l’image ait un dossier où aller.

## Pour vous repérer

- Le bouton **Table des matières** de la barre d’outils liste les titres et vous y emmène.
- Les deux volets défilent ensemble.
- Polices, tailles, apparence et sauts de ligne se trouvent dans les **Réglages** (⌘,).

Bonne écriture ! ✍️
