// Used by reads_total.html

// Component definition - can be imported and used in other Vue apps
const vReadsTotalComponent = {
    name: 'v-reads-total-component',
    props: ['query'],
    data() {
        return {
            THRESHOLD_DICT: {
                'HiSeq X': { 'default': 75.0 },
                'MiSeq': { '250': 60.0, '150': 70.0, '100': 75.0, 'default': 80.0 },
                'default': { '250': 60.0, '150': 75.0, '100': 80.0, 'default': 85.0 }
            },
            readsData: {},
            isHiseqX: false,
            showBulkFlowcellEditor: false,
            bulkFlowcellSearch: '',
            bulkSelectedFlowcells: {},
            highlightedSample: null,
            checkedState: {},
            expandedSamples: {},
            chartInstance: null,
            loading: true,
            error: null,
        };
    },
    
    computed: {
        hasData() {
            return this.sampleNames.length > 0;
        },
        sampleNames() {
            return Object.keys(this.readsData).filter(k => k !== 'isHiseqX');
        },
        summaryRows() {
            return this.sampleNames.map(sample => {
                let checkedReads = 0, uncheckedReads = 0, q30Sum = 0, checkedQ30Count = 0;
                const rows = this.readsData[sample];
                rows.forEach(d => {
                    const count = parseInt(d.cl) || 0;
                    if (this.checkedState[`${sample}_${d.fcp}`]) {
                        checkedReads += count;
                        const q30 = parseFloat(d.q30);
                        if (!Number.isNaN(q30)) {
                            q30Sum += q30;
                            checkedQ30Count += 1;
                        }
                    } else {
                        uncheckedReads += count;
                    }
                });
                const avgQ30 = checkedQ30Count > 0 ? q30Sum / checkedQ30Count : null;
                const firstRow = rows.find(d => d.run_mode != null) || rows[0];
                const threshold = firstRow ? this.getRowThreshold(firstRow) : 85.0;
                return { sample, checkedReads, uncheckedReads, avgQ30, threshold };
            });
        },
        summaryRowMap() {
            const map = {};
            this.summaryRows.forEach(r => { map[r.sample] = r.checkedReads; });
            return map;
        },
        summaryRowQ30Map() {
            const map = {};
            this.summaryRows.forEach(r => { map[r.sample] = r.avgQ30; });
            return map;
        },
        allFlowcellIds() {
            const ids = new Set();
            this.sampleNames.forEach(sample => {
                (this.readsData[sample] || []).forEach(d => {
                    ids.add(d.fcp);
                });
            });
            return Array.from(ids).sort();
        },
        filteredFlowcellIds() {
            const filter = this.bulkFlowcellSearch.trim().toLowerCase();
            if (!filter) return this.allFlowcellIds;
            return this.allFlowcellIds.filter(id => id.toLowerCase().includes(filter));
        },
        selectedFlowcellIds() {
            return this.allFlowcellIds.filter(id => this.bulkSelectedFlowcells[id]);
        },
        selectedFlowcellIdSet() {
            return new Set(this.selectedFlowcellIds);
        },
        bulkAffectedRowsCount() {
            const selectedSet = this.selectedFlowcellIdSet;
            let count = 0;
            if (selectedSet.size === 0) return 0;
            this.sampleNames.forEach(sample => {
                (this.readsData[sample] || []).forEach(d => {
                    if (selectedSet.has(d.fcp)) count += 1;
                });
            });
            return count;
        },
        bulkAffectedSamplesCount() {
            const selectedSet = this.selectedFlowcellIdSet;
            if (selectedSet.size === 0) return 0;
            return this.sampleNames.filter(sample => {
                return (this.readsData[sample] || []).some(d => selectedSet.has(d.fcp));
            }).length;
        },
        totalClusters() {
            return this.summaryRows.reduce((sum, r) => sum + r.checkedReads, 0);
        },
        isAllSelected() {
            const keys = Object.keys(this.checkedState);
            if (keys.length === 0) return false;
            return keys.every(key => this.checkedState[key]);
        },
        areAllSamplesExpanded() {
            if (this.sampleNames.length === 0) return false;
            return this.sampleNames.every(sample => this.expandedSamples[sample]);
        },
        countLabel() {
            return this.isHiseqX ? 'Clusters' : 'Reads';
        },
    },
    
    watch: {
        summaryRows() {
            this.$nextTick(() => this.renderChart());
        }
    },
    
    mounted() {
        if (this.query) {
            // Query was passed as prop, fetch data
            this.fetchData();
        }
    },
    
    methods: {
        fetchData() {
            axios.get(`/api/v1/reads_total/${this.query}`)
                .then(response => {
                    const data = response.data;
                    this.isHiseqX = data.isHiseqX || false;
                    delete data.isHiseqX;
                    this.readsData = data;
                    
                    // Initialize checkbox state
                    this.checkedState = {};
                    for (const [sample, rows] of Object.entries(this.readsData)) {
                        for (const d of rows) {
                            this.checkedState[`${sample}_${d.fcp}`] = this.isRowInitiallyChecked(d);
                        }
                    }
                    this.expandedSamples = {};
                    this.sampleNames.forEach(sample => {
                        this.expandedSamples[sample] = false;
                    });
                    this.bulkSelectedFlowcells = {};
                    this.bulkFlowcellSearch = '';
                    this.showBulkFlowcellEditor = false;
                    
                    this.loading = false;
                    this.$nextTick(() => this.renderChart());
                })
                .catch(error => {
                    console.error('Error fetching reads data:', error);
                    this.error = 'Failed to load data. Please try again.';
                    this.loading = false;
                });
        },
        
        getRowThreshold(d) {
            const run_mode = (d.run_mode === 'HiSeq X' || d.run_mode === 'MiSeq') ? d.run_mode : 'default';
            let run_setup = 'default';
            if (d.run_mode !== 'HiSeq X') {
                if (d.longer_read_length >= 250) run_setup = '250';
                else if (d.longer_read_length >= 150) run_setup = '150';
                else if (d.longer_read_length >= 100) run_setup = '100';
            }
            return this.THRESHOLD_DICT[run_mode][run_setup];
        },
        isRowInitiallyChecked(d) {
            if (d.fcp.includes('_UD')) return false;
            const threshold = this.getRowThreshold(d);
            return d.q30 !== null && d.q30 !== undefined &&
                   parseFloat(d.q30) >= threshold &&
                   (d.sample_status ?? '') !== 'Failed';
        },
        q30Class(d) {
            if (d.fcp.includes('_UD')) return '';
            const threshold = this.getRowThreshold(d);
            if (d.q30 !== null && d.q30 !== undefined && parseFloat(d.q30) >= threshold) {
                return 'table-success';
            }
            return 'table-warning';
        },
        fcpFlowcellUrl(fcp) {
            const parts = fcp.split('_');
            const lastPart = parts[parts.length - 1].split(':')[0];
            return `/flowcells/${parts[0]}_${lastPart}`;
        },
        projectFromSample(sample) {
            return sample.split('_')[0];
        },
        toggleAllSelection() {
            const nextValue = !this.isAllSelected;
            Object.keys(this.checkedState).forEach(key => {
                this.checkedState[key] = nextValue;
            });
        },
        highlightSample(sample) {
            this.highlightedSample = sample;
            this.expandedSamples[sample] = true;
            this.$nextTick(() => {
                const el = document.getElementById(sample);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth' });
                    location.hash = '#' + sample;
                }
            });
        },
        toggleSampleExpanded(sample) {
            this.expandedSamples[sample] = !this.expandedSamples[sample];
        },
        isSampleChecked(sample) {
            const rows = this.readsData[sample] || [];
            if (rows.length === 0) return false;
            return rows.every(d => this.checkedState[`${sample}_${d.fcp}`]);
        },
        isSampleIndeterminate(sample) {
            const rows = this.readsData[sample] || [];
            if (rows.length === 0) return false;
            const selectedCount = rows.filter(d => this.checkedState[`${sample}_${d.fcp}`]).length;
            return selectedCount > 0 && selectedCount < rows.length;
        },
        onSampleCheckboxChange(sample, event) {
            const isChecked = event.target.checked;
            (this.readsData[sample] || []).forEach(d => {
                this.checkedState[`${sample}_${d.fcp}`] = isChecked;
            });
        },
        formatQ30(value) {
            if (value === null || value === undefined) return '-';
            return Number(value).toFixed(2);
        },
        toggleBulkFlowcellEditor() {
            this.showBulkFlowcellEditor = !this.showBulkFlowcellEditor;
        },
        selectVisibleFlowcells() {
            this.filteredFlowcellIds.forEach(id => {
                this.bulkSelectedFlowcells[id] = true;
            });
        },
        clearVisibleFlowcells() {
            this.filteredFlowcellIds.forEach(id => {
                this.bulkSelectedFlowcells[id] = false;
            });
        },
        clearAllBulkSelections() {
            this.bulkSelectedFlowcells = {};
        },
        applyBulkFlowcellSelection(isChecked) {
            const selectedSet = this.selectedFlowcellIdSet;
            if (selectedSet.size === 0) return;
            this.sampleNames.forEach(sample => {
                (this.readsData[sample] || []).forEach(d => {
                    if (selectedSet.has(d.fcp)) {
                        this.checkedState[`${sample}_${d.fcp}`] = isChecked;
                    }
                });
            });
        },
        toggleAllSamplesExpanded() {
            const nextValue = !this.areAllSamplesExpanded;
            this.sampleNames.forEach(sample => {
                this.expandedSamples[sample] = nextValue;
            });
        },
        sampleFlowcellCount(sample) {
            return (this.readsData[sample] || []).length;
        },
        downloadMainTableTSV() {
            const rows = ['Sample\tReads\tQ30'];
            this.summaryRows.forEach(r => {
                const q30Value = r.avgQ30 === null ? '' : Number(r.avgQ30).toFixed(2);
                rows.push(`${r.sample}\t${r.checkedReads}\t${q30Value}`);
            });
            const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/tab-separated-values;charset=utf-8' });
            saveAs(blob, `${this.query}_reads_total.tsv`);
        },
        submitSearch() {
            const val = this.$refs.queryInput.value.trim();
            if (!val) {
                alert('Error - search term cannot be empty');
            } else {
                location.href = '/reads_total/' + val;
            }
        },
        renderChart() {
            if (!this.hasData) return;
            if (this.chartInstance) {
                this.chartInstance.destroy();
                this.chartInstance = null;
            }
            const sampleNames = this.summaryRows.map(r => r.sample);
            const seriesData = [
                { name: 'q30>threshold', data: [], color: '#78b560' },
                { name: 'q30<threshold', data: [], color: '#e8cd4c' },
                { name: 'Not Selected',  data: [], color: '#dddddd' }
            ];
            this.summaryRows.forEach(r => {
                if (r.avgQ30 !== null && r.avgQ30 >= r.threshold) {
                    seriesData[0].data.push(r.checkedReads);
                    seriesData[1].data.push(0);
                } else {
                    seriesData[0].data.push(0);
                    seriesData[1].data.push(r.checkedReads);
                }
                seriesData[2].data.push(r.uncheckedReads);
            });
            this.chartInstance = Highcharts.chart('reads_total_summary_chart', {
                credits: { enabled: false },
                chart: { type: 'column' },
                title: { text: 'Sample Read Counts' },
                subtitle: { text: 'Click a bar to see that sample' },
                xAxis: { categories: sampleNames },
                yAxis: {
                    min: 0,
                    title: { text: '# ' + this.countLabel },
                    reversedStacks: false
                },
                plotOptions: {
                    column: { stacking: 'normal', borderWidth: 0, groupPadding: 0.1 },
                    series: {
                        cursor: 'pointer',
                        point: {
                            events: {
                                click: (e) => { this.highlightSample(e.point.category); }
                            }
                        }
                    }
                },
                series: seriesData
            });
        }
    },
    template: /*html*/`
        <div>
            <h1>Read Count Totals: <span>{{ query }}</span></h1>
            <div id="querybox">
                <form @submit.prevent="submitSearch">
                    <div class="form-group">
                        <label class="fw-bold" for="reads_query">Enter new search term here:</label>
                        <div class="input-group" style="max-width: 400px;">
                            <input type="text" class="form-control" id="reads_query" ref="queryInput" placeholder="eg. P1234">
                            <span class="input-group-btn">
                                <button class="btn btn-outline-secondary" type="submit">Search</button>
                            </span>
                        </div>
                        <span class="form-text">Page finds any samples whose names begin with the search term.</span>
                    </div>
                </form>
            </div>
        </div>

        <template v-if="loading && query">
            <div class="alert alert-info mt-3">
                <span>Loading data...</span>
            </div>
        </template>

        <template v-else-if="error">
            <div class="alert alert-danger mt-3">
                <h4>Error</h4>
                <p>{{ error }}</p>
                <p>Please try again with the box above.</p>
            </div>
        </template>

        <template v-else-if="query === ''">
            <h3 class="mt-3">Welcome to the read count totals page!</h3>
            <p>To begin, enter a search term above and click <code>Search</code></p>
            <p>The search works by matching any sample names that begin with your search term. So P123 will match samples <code>P123_001</code> and <code>P1234_003</code></p>
            <p>Note that sample names do not have full project names such as <code>A.Project_15_03</code>, so these kinds of searches will not work.</p>
        </template>

        <template v-else-if="hasData">
            <div>
                <div id="reads_total_summary_chart"></div>
                <div class="btn-group mb-3" role="group">
                    <input type="button" class="btn btn-outline-secondary" :value="isAllSelected ? 'Uncheck all' : 'Check all'" @click="toggleAllSelection"/>
                    <input type="button" class="btn btn-outline-secondary" :value="areAllSamplesExpanded ? 'Collapse all' : 'Expand all'" @click="toggleAllSamplesExpanded"/>
                    <input type="button" class="btn btn-outline-secondary" :value="showBulkFlowcellEditor ? 'Hide bulk flowcell editor' : 'Bulk edit flowcells'" @click="toggleBulkFlowcellEditor"/>
                    <input type="button" class="btn btn-outline-secondary" value="Download main table as TSV" @click="downloadMainTableTSV"/>
                </div>
                <div v-if="showBulkFlowcellEditor" class="card mb-3">
                    <div class="card-body">
                        <div class="d-flex flex-wrap align-items-end gap-2 mb-3">
                            <div style="min-width: 260px;">
                                <label class="form-label fw-bold" for="bulk_flowcell_search">Find flowcell or lane</label>
                                <input id="bulk_flowcell_search" type="text" class="form-control" v-model="bulkFlowcellSearch" placeholder="Search IDs"/>
                            </div>
                            <input type="button" class="btn btn-outline-secondary" value="Select visible" @click="selectVisibleFlowcells"/>
                            <input type="button" class="btn btn-outline-secondary" value="Clear visible" @click="clearVisibleFlowcells"/>
                            <input type="button" class="btn btn-outline-secondary" value="Clear selected IDs" @click="clearAllBulkSelections"/>
                        </div>

                        <p class="mb-2">
                            Selected IDs: {{ selectedFlowcellIds.length }}.
                            Matching rows: {{ bulkAffectedRowsCount }} across {{ bulkAffectedSamplesCount }} samples.
                        </p>

                        <div style="max-height: 220px; overflow: auto; border: 1px solid #d9d9d9; border-radius: 4px; padding: 8px;">
                            <div v-if="filteredFlowcellIds.length === 0" class="text-muted">No flowcell/lane IDs match this search.</div>
                            <div v-for="id in filteredFlowcellIds" :key="id" class="form-check">
                                <input class="form-check-input" type="checkbox" :id="'bulk_' + id" v-model="bulkSelectedFlowcells[id]"/>
                                <label class="form-check-label" :for="'bulk_' + id">{{ id }}</label>
                            </div>
                        </div>

                        <div class="d-flex gap-2 mt-3">
                            <input type="button" class="btn btn-primary" value="Check selected IDs across all samples" :disabled="selectedFlowcellIds.length === 0" @click="applyBulkFlowcellSelection(true)"/>
                            <input type="button" class="btn btn-outline-primary" value="Uncheck selected IDs across all samples" :disabled="selectedFlowcellIds.length === 0" @click="applyBulkFlowcellSelection(false)"/>
                        </div>
                    </div>
                </div>
                <div class="container-fluid">
                    <table class="table table-hover table-striped align-middle reads_table">
                        <thead>
                            <tr class="darkth">
                                <th style="position: sticky; top: 0; z-index: 2;">Include</th>
                                <th style="position: sticky; top: 0; z-index: 2;">Sample</th>
                                <th class="text-end" style="position: sticky; top: 0; z-index: 2; font-variant-numeric: tabular-nums;">Flowcells</th>
                                <th class="text-end" style="position: sticky; top: 0; z-index: 2; font-variant-numeric: tabular-nums;">{{ countLabel }} (selected)</th>
                                <th class="text-end" style="position: sticky; top: 0; z-index: 2; font-variant-numeric: tabular-nums;">Average % > q30 (selected)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="sample in sampleNames" :key="sample">
                                <tr :id="sample" class="sample_table"
                                    :class="{ highlighted: highlightedSample === sample }"
                                    style="cursor: pointer; transition: background-color 0.15s ease;"
                                    @click="toggleSampleExpanded(sample)">
                                    <td>
                                        <input
                                            type="checkbox"
                                            :checked="isSampleChecked(sample)"
                                            :indeterminate.prop="isSampleIndeterminate(sample)"
                                            @click.stop
                                            @change="onSampleCheckboxChange(sample, $event)"
                                        />
                                    </td>
                                    <td>
                                        <span class="me-2" style="display: inline-block; font-size: 1.1rem; transition: transform 0.15s ease;" :style="{ transform: expandedSamples[sample] ? 'rotate(90deg)' : 'rotate(0deg)' }">▶</span>
                                        <a class="text-decoration-none" :href="'/project/' + projectFromSample(sample)" @click.stop>{{ sample }}</a>
                                    </td>
                                    <td class="text-end" style="font-variant-numeric: tabular-nums;">{{ sampleFlowcellCount(sample) }}</td>
                                    <td class="text-end" style="font-variant-numeric: tabular-nums;">{{ summaryRowMap[sample].toLocaleString() }}</td>
                                    <td class="text-end" style="font-variant-numeric: tabular-nums;">{{ formatQ30(summaryRowQ30Map[sample]) }}</td>
                                </tr>
                                <tr v-if="expandedSamples[sample]">
                                    <td colspan="5" style="padding: 0 0 10px 30px;">
                                        <table class="table table-sm table-hover table-striped mb-0 align-middle">
                                            <thead>
                                                <tr class="darkth">
                                                    <th>Include</th>
                                                    <th>Flowcell:Lane</th>
                                                    <th class="text-end" style="font-variant-numeric: tabular-nums;">{{ countLabel }}</th>
                                                    <th class="text-end" style="font-variant-numeric: tabular-nums;">% > q30</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr v-for="d in readsData[sample]" :key="d.fcp">
                                                    <td><input type="checkbox" v-model="checkedState[sample + '_' + d.fcp]"/></td>
                                                    <td><a class="text-decoration-none" :href="fcpFlowcellUrl(d.fcp)">{{ d.fcp }}</a></td>
                                                    <td class="text-end" style="font-variant-numeric: tabular-nums;">{{ d.cl }}</td>
                                                    <td class="text-end" :class="q30Class(d)" style="font-variant-numeric: tabular-nums;">{{ d.q30 }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                        <tfoot>
                            <tr class="darkth">
                                <th></th>
                                <th></th>
                                <th></th>
                                <th class="text-end">Total selected</th>
                                <th class="text-end" style="font-variant-numeric: tabular-nums;">{{ totalClusters.toLocaleString() }}</th>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </template>

        <template v-else>
            <div class="alert alert-danger mt-3">
                <h4>Error - No samples found</h4>
                <p>Sorry, we weren't able to find any samples matching <code>{{ query }}</code>. Please try again with the box above.</p>
                <p>The search works by matching any sample names that begin with your search term. So P123 will match samples <code>P123_001</code> and <code>P1234_003</code></p>
                <p>Note that sample names do not have full project names such as <code>A.Project_15_03</code>, so these kinds of searches will not work.</p>
            </div>
        </template>
    `
};

  const app = Vue.createApp({
    components: { 'v-reads-total-component': vReadsTotalComponent },
    data() {
      return { query: "{{ query }}" };
    }
  });
  app.mount('#reads_total_app');
