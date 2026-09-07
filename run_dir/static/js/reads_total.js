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
            checkKeyFilter: '',
            highlightedSample: null,
            checkedState: {},
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
        sampleChunks() {
            const chunks = [];
            for (let i = 0; i < this.sampleNames.length; i += 2) {
                chunks.push(this.sampleNames.slice(i, i + 2));
            }
            return chunks;
        },
        summaryRows() {
            return this.sampleNames.map(sample => {
                let checked = 0, unchecked = 0, w_q30_sum = 0;
                const rows = this.readsData[sample];
                rows.forEach(d => {
                    const count = parseInt(d.cl) || 0;
                    if (this.checkedState[`${sample}_${d.fcp}`]) {
                        w_q30_sum += (parseFloat(d.q30) || 0) * count;
                        checked += count;
                    } else {
                        unchecked += count;
                    }
                });
                const w_q30 = checked > 0 ? w_q30_sum / checked : -1;
                const firstRow = rows.find(d => d.run_mode != null) || rows[0];
                const threshold = firstRow ? this.getRowThreshold(firstRow) : 85.0;
                return { sample, checked, unchecked, w_q30, threshold };
            });
        },
        summaryRowMap() {
            const map = {};
            this.summaryRows.forEach(r => { map[r.sample] = r.checked; });
            return map;
        },
        totalClusters() {
            return this.summaryRows.reduce((sum, r) => sum + r.checked, 0);
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
        checkAll() {
            const filter = this.checkKeyFilter;
            Object.keys(this.checkedState).forEach(key => {
                if (key.includes(filter)) this.checkedState[key] = true;
            });
        },
        uncheckAll() {
            const filter = this.checkKeyFilter;
            Object.keys(this.checkedState).forEach(key => {
                if (key.includes(filter)) this.checkedState[key] = false;
            });
        },
        highlightSample(sample) {
            this.highlightedSample = sample;
            this.$nextTick(() => {
                const el = document.getElementById(sample);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth' });
                    location.hash = '#' + sample;
                }
            });
        },
        downloadMainTableTSV() {
            const rows = [`Sample\tFlowcell\tQ30\tSelected\t${this.countLabel}`];
            this.sampleNames.forEach(sample => {
                this.readsData[sample].forEach(d => {
                    const selected = this.checkedState[`${sample}_${d.fcp}`] ? 'Yes' : 'No';
                    const q30Value = d.q30 ?? '';
                    const countValue = d.cl ?? '';
                    rows.push(`${sample}\t${d.fcp}\t${q30Value}\t${selected}\t${countValue}`);
                });
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
                if (r.w_q30 >= r.threshold) {
                    seriesData[0].data.push(r.checked);
                    seriesData[1].data.push(0);
                } else {
                    seriesData[0].data.push(0);
                    seriesData[1].data.push(r.checked);
                }
                seriesData[2].data.push(r.unchecked);
            });
            this.chartInstance = Highcharts.chart('reads_total_summary_chart', {
                credits: { enabled: false },
                chart: { type: 'column' },
                title: { text: 'Sample Read Counts' },
                subtitle: { text: 'Click a bar to see that sample' },
                xAxis: { categories: sampleNames },
                yAxis: {
                    min: 0,
                    title: { text: '# Clusters' },
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
                    <input type="button" class="btn btn-outline-secondary" value="Check all" @click="checkAll"/>
                    <input type="button" class="btn btn-outline-secondary" value="Uncheck all" @click="uncheckAll"/>
                    <input type="button" class="btn btn-outline-secondary" value="Download main table as TSV" @click="downloadMainTableTSV"/>
                    <input type="text" class="form-control" v-model="checkKeyFilter"/>
                </div>
                <div class="container-fluid">
                    <template v-for="(chunk, idx) in sampleChunks" :key="idx">
                        <hr>
                        <div class="row">
                            <div v-for="sample in chunk" :key="sample" :id="sample"
                                 class="col-lg-6 sample_table" :class="{ highlighted: highlightedSample === sample }"
                                 style="padding-top: 15px;">
                                <table class="table reads_table">
                                    <thead>
                                        <tr class="darkth">
                                            <th><a class="text-decoration-none" :href="'/project/' + projectFromSample(sample)">{{ sample }}</a></th>
                                            <th>% > q30</th>
                                            <th>Add</th>
                                            <th>{{ countLabel }}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="d in readsData[sample]" :key="d.fcp">
                                            <td><a class="text-decoration-none" :href="fcpFlowcellUrl(d.fcp)">{{ d.fcp }}</a></td>
                                            <td :class="q30Class(d)">{{ d.q30 }}</td>
                                            <td><input type="checkbox" v-model="checkedState[sample + '_' + d.fcp]"/></td>
                                            <td>{{ d.cl }}</td>
                                        </tr>
                                    </tbody>
                                    <tfoot>
                                        <tr class="darkth">
                                            <th>Total</th>
                                            <th></th>
                                            <th>{{ sample }}</th>
                                            <th>{{ summaryRowMap[sample].toLocaleString() }}</th>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </template>
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
