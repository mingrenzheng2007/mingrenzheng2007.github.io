(function () {
  const rankList = document.getElementById("pso-rank-list");
  if (!rankList) return;

  // Scores and ranks: manuscript Table 1. Group membership: Table 11.
  const countries = [
    {"name": "Antigua and Barbuda", "iso": "AG", "scores": [0.781, 0.7824], "ranks": [10, 14], "groups": [2, 3]},
    {"name": "Argentina", "iso": "AR", "scores": [0.6098, 0.7642], "ranks": [21, 16], "groups": [2, 4]},
    {"name": "Barbados", "iso": "BB", "scores": [0.8485, 0.8558], "ranks": [4, 9], "groups": [2, 3]},
    {"name": "Belize", "iso": "BZ", "scores": [0.5246, 0.6891], "ranks": [31, 23], "groups": [4, 4]},
    {"name": "Bolivia", "iso": "BO", "scores": [0.4753, 0.5255], "ranks": [32, 33], "groups": [4, 4]},
    {"name": "Brazil", "iso": "BR", "scores": [0.7616, 0.9215], "ranks": [11, 2], "groups": [2, 4]},
    {"name": "Canada", "iso": "CA", "scores": [1.0, 1.0], "ranks": [1, 1], "groups": [1, 1]},
    {"name": "Chile", "iso": "CL", "scores": [0.6635, 0.884], "ranks": [17, 6], "groups": [2, 3]},
    {"name": "Colombia", "iso": "CO", "scores": [0.7415, 0.72], "ranks": [12, 22], "groups": [4, 4]},
    {"name": "Costa Rica", "iso": "CR", "scores": [0.8178, 0.7401], "ranks": [7, 19], "groups": [4, 3]},
    {"name": "Cuba", "iso": "CU", "scores": [0.7817, 0.7642], "ranks": [9, 15], "groups": [2, 4]},
    {"name": "Dominica", "iso": "DM", "scores": [0.703, 0.5474], "ranks": [14, 30], "groups": [4, 4]},
    {"name": "Dominican Republic", "iso": "DO", "scores": [0.6022, 0.4659], "ranks": [24, 34], "groups": [4, 4]},
    {"name": "Ecuador", "iso": "EC", "scores": [0.418, 0.7594], "ranks": [33, 17], "groups": [4, 4]},
    {"name": "El Salvador", "iso": "SV", "scores": [0.5532, 0.6477], "ranks": [27, 26], "groups": [4, 4]},
    {"name": "Grenada", "iso": "GD", "scores": [0.7315, 0.685], "ranks": [13, 24], "groups": [4, 4]},
    {"name": "Guatemala", "iso": "GT", "scores": [0.5775, 0.6014], "ranks": [26, 27], "groups": [4, 4]},
    {"name": "Guyana", "iso": "GY", "scores": [0.0, 0.7365], "ranks": [35, 20], "groups": [4, 4]},
    {"name": "Haiti", "iso": "HT", "scores": [0.4069, 0.0], "ranks": [34, 35], "groups": [4, 4]},
    {"name": "Honduras", "iso": "HN", "scores": [0.6062, 0.7566], "ranks": [22, 18], "groups": [4, 4]},
    {"name": "Jamaica", "iso": "JM", "scores": [0.6037, 0.5463], "ranks": [23, 31], "groups": [4, 4]},
    {"name": "Mexico", "iso": "MX", "scores": [0.5526, 0.7949], "ranks": [28, 12], "groups": [2, 4]},
    {"name": "Nicaragua", "iso": "NI", "scores": [0.5292, 0.848], "ranks": [30, 10], "groups": [4, 4]},
    {"name": "Panama", "iso": "PA", "scores": [0.844, 0.7347], "ranks": [5, 21], "groups": [4, 3]},
    {"name": "Paraguay", "iso": "PY", "scores": [0.5886, 0.6592], "ranks": [25, 25], "groups": [4, 4]},
    {"name": "Peru", "iso": "PE", "scores": [0.6111, 0.598], "ranks": [20, 28], "groups": [4, 4]},
    {"name": "Saint Lucia", "iso": "LC", "scores": [0.6223, 0.5319], "ranks": [19, 32], "groups": [4, 4]},
    {"name": "Saint Vincent and the Grenadines", "iso": "VC", "scores": [0.9656, 0.9035], "ranks": [2, 4], "groups": [4, 4]},
    {"name": "St. Kitts and Nevis", "iso": "KN", "scores": [0.8154, 0.7926], "ranks": [8, 13], "groups": [2, 3]},
    {"name": "Suriname", "iso": "SR", "scores": [0.8363, 0.8261], "ranks": [6, 11], "groups": [4, 4]},
    {"name": "The Bahamas", "iso": "BS", "scores": [0.672, 0.8813], "ranks": [16, 7], "groups": [3, 3]},
    {"name": "Trinidad and Tobago", "iso": "TT", "scores": [0.6788, 0.8687], "ranks": [15, 8], "groups": [2, 3]},
    {"name": "United States", "iso": "US", "scores": [0.8907, 0.9138], "ranks": [3, 3], "groups": [1, 2]},
    {"name": "Uruguay", "iso": "UY", "scores": [0.5522, 0.8961], "ranks": [29, 5], "groups": [2, 3]},
    {"name": "Venezuela", "iso": "VE", "scores": [0.6379, 0.5699], "ranks": [18, 29], "groups": [2, 4]}
  ];
  const quality = {
    2010: [["PSO + K-means", 0.597, 0.319, 212.755], ["K-means", 0.597, 0.319, 212.755], ["Hierarchical clustering", 0.563, 0.430, 193.648]],
    2020: [["PSO + K-means", 0.648, 0.280, 213.406], ["K-means", 0.648, 0.280, 213.406], ["Hierarchical clustering", 0.648, 0.280, 213.406]]
  };
  const groupColors = ["#74d5c5", "#ffc56a", "#80bde3", "#ed9e8a"];
  const expandButton = document.getElementById("pso-expand");
  let selectedYear = "2020";
  let expanded = false;

  function render() {
    const yearIndex = selectedYear === "2010" ? 0 : 1;
    const ordered = [...countries].sort((a, b) => a.ranks[yearIndex] - b.ranks[yearIndex]);
    const shown = expanded ? ordered : ordered.slice(0, 10);

    rankList.innerHTML = shown.map(country => `
      <li style="--pso-score:${country.scores[yearIndex] * 100}%">
        <b>${country.ranks[yearIndex]}</b>
        <span class="pso-country"><strong>${country.name}</strong><small>${country.iso}</small></span>
        <span class="pso-bar" aria-hidden="true"><span></span></span>
        <output aria-label="Composite score">${country.scores[yearIndex].toFixed(4)}</output>
      </li>`).join("");

    document.getElementById("pso-visible-count").textContent = shown.length;
    expandButton.textContent = expanded ? "Show top 10 countries" : "Show all 35 countries";
    expandButton.setAttribute("aria-expanded", String(expanded));
    document.querySelectorAll("[data-pso-selected-year]").forEach(element => {
      element.textContent = selectedYear;
    });
    document.querySelectorAll("[data-pso-year]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.psoYear === selectedYear));
    });

    document.getElementById("pso-groups").innerHTML = [1, 2, 3, 4].map(group => {
      const members = countries.filter(country => country.groups[yearIndex] === group);
      return `<article class="pso-group" style="--group-color:${groupColors[group - 1]}">
        <p>Group ${group}</p><h3>${members.length} ${members.length === 1 ? "country" : "countries"}</h3>
        <ul aria-label="Countries in group ${group}">${members.map(country => `<li title="${country.name}" aria-label="${country.name}">${country.iso}</li>`).join("")}</ul>
      </article>`;
    }).join("");

    document.getElementById("pso-quality-rows").innerHTML = quality[selectedYear].map(row => `
      <tr><th scope="row">${row[0]}</th><td>${row[1].toFixed(3)}</td><td>${row[2].toFixed(3)}</td><td>${row[3].toFixed(3)}</td></tr>`).join("");
    document.getElementById("pso-quality-reading").textContent = selectedYear === "2010"
      ? "In 2010, PSO + K-means and conventional K-means report the same values on all three metrics. Both have a higher Silhouette score and Calinski–Harabasz index, and a lower Davies–Bouldin index, than hierarchical clustering. PSO's role in the framework is to optimize centroid initialization."
      : "In 2020, all three methods report a Silhouette score of 0.648, a Davies–Bouldin index of 0.280, and a Calinski–Harabasz index of 213.406. These metrics show the same clustering quality in this benchmark; the PSO stage focuses on optimizing centroid initialization.";
  }

  document.querySelectorAll("[data-pso-year]").forEach(button => {
    button.addEventListener("click", () => {
      selectedYear = button.dataset.psoYear;
      render();
    });
  });
  expandButton.addEventListener("click", () => {
    expanded = !expanded;
    render();
  });
  render();
})();
